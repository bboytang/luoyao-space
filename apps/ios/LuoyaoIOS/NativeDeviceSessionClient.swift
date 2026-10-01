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
    var failed: ((Error) -> Void)?

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didOpenWithProtocol negotiatedProtocol: String?) {
        opened?()
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        closed?()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error { failed?(error) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        // Never forward the development credential to a redirected endpoint.
        completionHandler(nil)
    }
}

@MainActor final class NativeDeviceSessionClient: ObservableObject, VoiceWire {
    @Published private(set) var state: DeviceSessionState = .disconnected
    @Published private(set) var diagnostic = "Not connected"
    @Published private(set) var rejectionReason: String?
    @Published private(set) var sessionID: String?
    @Published private(set) var canListen = false
    @Published private(set) var canPlay = false
    @Published private(set) var transcript = ""
    @Published private(set) var voiceStatus = "Voice unavailable until admission"
    @Published private(set) var microphoneStatus = "Microphone permission not requested"

    private var machine: DeviceSessionMachine?
    private var socket: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private var delegate: SocketLifecycleDelegate?
    private var connectionID = UUID()
    private let audioSession = NativeAudioSessionManager()
    private let microphone = NativeMicrophoneCapture()
    private let playback = NativePCMPlayback()
    private lazy var voice = VoiceTurnController(capture: microphone, playback: playback, wire: self)

    let deviceId: String

    init(deviceIDs: DeviceIDStore = DeviceIDStore()) {
        deviceId = deviceIDs.loadOrCreate()
        microphoneStatus = audioSession.microphoneStatus
        audioSession.onHardwareChange = { [weak self] in
            guard let self, self.state == .accepted else { return }
            self.disconnect()
            self.diagnostic = "Audio route/interruption changed; reconnect to renegotiate availability"
        }
        playback.onPlayedBack = { [weak self] in
            self?.voice.playbackDidFinish()
            self?.voiceStatus = self?.voice.responseStatus ?? "Playback completed"
        }
    }

    func requestMicrophonePermission() async {
        _ = await audioSession.requestMicrophonePermission()
        microphoneStatus = audioSession.microphoneStatus
        if state == .accepted {
            disconnect()
            diagnostic = "Microphone permission changed; reconnect to negotiate current availability"
        }
    }

    func connect(endpoint: String, developmentToken: String) {
        disconnect()
        do {
            let settings = try DevelopmentConnectionSettings(endpoint: endpoint, token: developmentToken)
            var hardwareActive = true
            do { try audioSession.activate() }
            catch { hardwareActive = false }
            let current = hardwareActive ? audioSession.capabilities() : (input: false, output: false)
            let hello = try DeviceHello.ios(deviceId: deviceId,
                supported: VoiceCapabilityOffers.supported,
                available: VoiceCapabilityOffers.available(input: current.input, output: current.output))
            microphoneStatus = audioSession.microphoneStatus
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
            let task = session.webSocketTask(with: settings.request())
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
            lifecycle.failed = { [weak self] error in
                Task { @MainActor in self?.fail(error, generation: generation) }
            }
            task.resume()
        } catch DevelopmentConnectionSettingsError.invalidEndpoint {
            diagnostic = "Enter a wss:// endpoint without URL credentials, query or fragment"
        } catch DevelopmentConnectionSettingsError.invalidCredential {
            diagnostic = "Enter the 64-character development credential"
        } catch {
            diagnostic = "Cannot construct v2 connection"
        }
    }

    func disconnect() {
        connectionID = UUID() // Invalidates all pending events from the old connection.
        voice.terminate()
        audioSession.deactivate()
        socket?.cancel(with: .normalClosure, reason: nil)
        urlSession?.invalidateAndCancel()
        socket = nil
        urlSession = nil
        delegate = nil
        machine?.transportClosed()
        machine = nil
        state = .disconnected
        sessionID = nil
        canListen = false
        canPlay = false
        voiceStatus = "Voice unavailable until admission"
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
                            if let accepted = current.accepted {
                                voice.admit(accepted, hello: current.hello)
                                canListen = voice.canListen
                                canPlay = voice.canPlay
                            }
                            diagnostic = "Device Session v2 accepted"
                            voiceStatus = canListen ? "Tap Start to begin a voice turn" : "Voice input not negotiated"
                        } else if state == .rejected {
                            rejectionReason = current.rejection?.reason
                            diagnostic = "Admission rejected: \(rejectionReason ?? "unknown")"
                            task.cancel(with: .normalClosure, reason: nil)
                            return
                        }
                    } else if state == .accepted {
                        let control = try JSONDecoder().decode(ServerVoiceControl.self, from: data)
                        voice.receiveServerControl(control)
                        transcript = voice.transcript
                        voiceStatus = voice.responseStatus
                    }
                case .data(let bytes):
                    guard state == .accepted else { throw DeviceSessionContractError.invalidResponse }
                    try voice.receiveAudio(bytes)
                    voiceStatus = "Playback active"
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
        voice.terminate()
        audioSession.deactivate()
        canListen = false
        canPlay = false
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
        if state == .rejected || (error as? URLError)?.code == .cancelled { return }
        connectionID = UUID() // A later close callback must not erase the diagnostic.
        voice.terminate()
        audioSession.deactivate()
        canListen = false
        canPlay = false
        diagnostic = DevelopmentConnectionDiagnostics.describe(error)
        machine?.transportClosed()
        state = .disconnected
        sessionID = nil
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        urlSession?.invalidateAndCancel()
        urlSession = nil
        delegate = nil
    }

    func startListening() async {
        do {
            try await voice.startListening()
            voiceStatus = "Listening"
        } catch { voiceStatus = "Cannot start voice: \(error.localizedDescription)" }
    }

    func stopListening() async {
        do {
            try await voice.stopListening()
            voiceStatus = "Processing voice turn"
        } catch { voiceStatus = "Cannot stop voice: \(error.localizedDescription)" }
    }

    func cancelTurn() async {
        do {
            try await voice.cancel()
            voiceStatus = "Turn canceled"
        } catch { voiceStatus = "Cannot cancel turn: \(error.localizedDescription)" }
    }

    func sendControl(_ control: ClientControl) async throws {
        guard state == .accepted, let socket else { throw VoiceAudioError.notAccepted }
        let data = try JSONEncoder().encode(control)
        guard let text = String(data: data, encoding: .utf8) else { throw VoiceAudioError.incompatibleAudio }
        try await socket.send(.string(text))
    }

    func sendAudio(_ data: Data) async throws {
        guard state == .accepted, let socket else { throw VoiceAudioError.notAccepted }
        try await socket.send(.data(data))
    }
}
