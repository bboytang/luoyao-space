import Foundation
import Combine

/// A declared device ID is stable local metadata, never an authentication credential.
struct DeviceIDStore {
    let defaults: UserDefaults
    private let key = "space.luoyao.device-id.v2"

    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    func loadOrCreate() -> String {
        if let saved = defaults.string(forKey: key), !saved.isEmpty { return saved }
        let created = UUID().uuidString.lowercased()
        defaults.set(created, forKey: key)
        return created
    }
}

private final class SocketLifecycleDelegate: NSObject, URLSessionWebSocketDelegate {
    var opened: (() -> Void)?
    var closed: (() -> Void)?

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didOpenWithProtocol negotiatedProtocol: String?) {
        opened?()
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        closed?()
    }
}

@MainActor final class NativeDeviceSessionClient: ObservableObject {
    @Published private(set) var state: DeviceSessionState = .disconnected
    @Published private(set) var diagnostic = "Not connected"
    @Published private(set) var rejectionReason: String?
    @Published private(set) var sessionID: String?

    private var machine: DeviceSessionMachine?
    private var socket: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private var delegate: SocketLifecycleDelegate?
    private var connectionID = UUID()

    let deviceId: String

    init(deviceIDs: DeviceIDStore = DeviceIDStore()) {
        deviceId = deviceIDs.loadOrCreate()
    }

    func connect(endpoint: String) {
        disconnect()
        guard let url = URL(string: endpoint), url.scheme?.lowercased() == "wss",
              let host = url.host, !host.isEmpty, url.user == nil, url.password == nil else {
            diagnostic = "Enter a secure wss:// endpoint without embedded credentials"
            return
        }

        do {
            // No audio hardware is declared in C1. Capability availability is determined by later native adapters.
            let hello = try DeviceHello.ios(deviceId: deviceId)
            machine = DeviceSessionMachine(hello: hello)
            state = .connecting
            diagnostic = "Connecting transport"
            rejectionReason = nil
            sessionID = nil
            let generation = UUID()
            connectionID = generation
            let lifecycle = SocketLifecycleDelegate()
            delegate = lifecycle
            let session = URLSession(configuration: .default, delegate: lifecycle, delegateQueue: nil)
            urlSession = session
            let task = session.webSocketTask(with: url)
            socket = task
            lifecycle.opened = { [weak self, weak task] in
                Task { @MainActor in
                    guard let self, let task, self.connectionID == generation else { return }
                    await self.handleOpen(task, generation: generation)
                }
            }
            lifecycle.closed = { [weak self] in
                Task { @MainActor in self?.handleClose(generation: generation) }
            }
            task.resume()
        } catch {
            diagnostic = "Cannot construct v2 hello: \(error.localizedDescription)"
        }
    }

    func disconnect() {
        connectionID = UUID() // Invalidates all pending events from the old connection.
        socket?.cancel(with: .normalClosure, reason: nil)
        urlSession?.invalidateAndCancel()
        socket = nil
        urlSession = nil
        delegate = nil
        machine?.transportClosed()
        machine = nil
        state = .disconnected
        sessionID = nil
        diagnostic = "Disconnected"
    }

    private func handleOpen(_ task: URLSessionWebSocketTask, generation: UUID) async {
        guard connectionID == generation, var current = machine else { return }
        current.transportOpened()
        machine = current
        state = current.state
        diagnostic = "Transport open; sending v2 hello"
        do {
            let data = try current.hello.encode()
            guard let text = String(data: data, encoding: .utf8) else { throw DeviceSessionContractError.invalidHello }
            try await task.send(.string(text))
            guard connectionID == generation, var awaiting = machine else { return }
            awaiting.helloSent()
            machine = awaiting
            state = awaiting.state
            diagnostic = "Awaiting device admission"
            await receiveLoop(task, generation: generation)
        } catch {
            fail(error, generation: generation)
        }
    }

    private func receiveLoop(_ task: URLSessionWebSocketTask, generation: UUID) async {
        do {
            while connectionID == generation {
                let message = try await task.receive()
                guard connectionID == generation else { return }
                switch message {
                case .string(let text):
                    guard let data = text.data(using: .utf8) else { throw DeviceSessionContractError.invalidResponse }
                    if state == .awaitingAdmission {
                        guard var current = machine else { return }
                        try current.receive(data)
                        machine = current
                        state = current.state
                        if state == .accepted {
                            sessionID = current.accepted?.transportSessionId
                            diagnostic = "Device Session v2 accepted"
                        } else if state == .rejected {
                            rejectionReason = current.rejection?.reason
                            diagnostic = "Admission rejected: \(rejectionReason ?? "unknown")"
                            task.cancel(with: .normalClosure, reason: nil)
                            return
                        }
                    } else if state == .accepted {
                        diagnostic = "Device Session v2 active; control received"
                    }
                case .data(let bytes):
                    guard state == .accepted else { throw DeviceSessionContractError.invalidResponse }
                    _ = try LYA1AudioCodec.decode(bytes)
                    diagnostic = "Binary frame received (playback is M2-C2)"
                @unknown default:
                    throw DeviceSessionContractError.invalidResponse
                }
            }
        } catch {
            fail(error, generation: generation)
        }
    }

    private func handleClose(generation: UUID) {
        guard connectionID == generation else { return }
        machine?.transportClosed()
        if state != .rejected {
            state = .disconnected
            sessionID = nil
            diagnostic = "Transport disconnected; reconnect creates a new session"
        }
        socket = nil
        urlSession?.invalidateAndCancel()
        urlSession = nil
        delegate = nil
    }

    private func fail(_ error: Error, generation: UUID) {
        guard connectionID == generation else { return }
        diagnostic = "Connection error: \(error.localizedDescription)"
        machine?.transportClosed()
        state = .disconnected
        sessionID = nil
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        urlSession?.invalidateAndCancel()
        urlSession = nil
        delegate = nil
    }
}
