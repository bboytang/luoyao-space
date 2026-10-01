import Foundation

enum VoiceAudioError: Error {
    case notAccepted
    case inputNotNegotiated
    case outputNotNegotiated
    case incompatibleAudio
    case oldTurnNotTerminated
}

enum VoiceCapabilityOffers {
    static let pcm = DeviceAudioFormat(codec: "pcm_s16le", sampleRateHz: 24_000, channels: 1)
    static let supported = [CapabilityOffer(id: "realtime.voice"),
        CapabilityOffer(id: "audio.input", formats: [pcm]),
        CapabilityOffer(id: "audio.output", formats: [pcm])]

    static func available(input: Bool, output: Bool) -> [CapabilityOffer] {
        var offers: [CapabilityOffer] = []
        if input && output { offers.append(supported[0]) }
        if input { offers.append(supported[1]) }
        if output { offers.append(supported[2]) }
        return offers
    }
}

enum PCM16 {
    static func pack(samples: [Float]) -> Data {
        var bytes: [UInt8] = []
        bytes.reserveCapacity(samples.count * 2)
        for sample in samples {
            let finite = sample.isFinite ? sample : 0
            let clamped = min(1, max(-1, finite))
            let quantized = clamped <= -1 ? Int16.min : Int16((clamped * 32767).rounded())
            let bits = UInt16(bitPattern: quantized)
            bytes.append(UInt8(bits & 0xff))
            bytes.append(UInt8(bits >> 8))
        }
        return Data(bytes)
    }

    static func unpack(_ data: Data) throws -> [Float] {
        let bytes = [UInt8](data)
        guard !bytes.isEmpty, bytes.count.isMultiple(of: 2) else { throw VoiceAudioError.incompatibleAudio }
        return stride(from: 0, to: bytes.count, by: 2).map { index in
            let bits = UInt16(bytes[index]) | (UInt16(bytes[index + 1]) << 8)
            let sample = Int16(bitPattern: bits)
            return sample == Int16.min ? -1 : Float(sample) / 32767
        }
    }
}

@MainActor protocol VoiceCapture: AnyObject {
    func start() throws -> AsyncStream<Data>
    func stop()
}

@MainActor protocol VoicePlayback: AnyObject {
    func enqueue(_ data: Data) throws
    func streamEnded()
    func stop()
}

@MainActor protocol VoiceWire: AnyObject {
    func sendControl(_ control: ClientControl) async throws
    func sendAudio(_ data: Data) async throws
}

struct ServerVoiceControl: Decodable {
    let type: String
    var state: String? = nil
    var messageId: String? = nil
    var text: String? = nil
    var final: Bool? = nil
    var code: String? = nil
    var message: String? = nil
}

/// Current transport/turn owner only. Hardware adapters never decide admission.
@MainActor final class VoiceTurnController {
    private let capture: VoiceCapture
    private let playback: VoicePlayback
    private let wire: VoiceWire
    private var accepted: AcceptedDeviceSession?
    private var hello: DeviceHello?
    private var generation = 0
    private var captureTask: Task<Void, Never>?
    private var sequence: UInt32 = 0
    private var listening = false
    private var starting = false
    private var playbackPending = false
    private var turnPending = false
    private var activeTTSMessageID: String?
    private var ttsServerEnded = true
    private var oldTurnWaiter: CheckedContinuation<Void, Error>?

    private(set) var transcript = ""
    private(set) var responseStatus = ""

    init(capture: VoiceCapture, playback: VoicePlayback, wire: VoiceWire) {
        self.capture = capture
        self.playback = playback
        self.wire = wire
    }

    var isAccepted: Bool { accepted != nil }
    var canListen: Bool { negotiatedFormat("audio.input") != nil && hasVoice }
    var canPlay: Bool { negotiatedFormat("audio.output") != nil && hasVoice }

    func admit(_ session: AcceptedDeviceSession, hello: DeviceHello) {
        if accepted != nil { terminate() }
        accepted = session
        self.hello = hello
        sequence = 0
        turnPending = false
        transcript = ""
        responseStatus = ""
    }

    func startListening() async throws {
        guard isAccepted else { throw VoiceAudioError.notAccepted }
        guard canListen else { throw VoiceAudioError.inputNotNegotiated }
        if listening || starting { return }
        starting = true
        defer { starting = false }
        let owner = generation

        if turnPending || playbackPending || !ttsServerEnded {
            playback.stop()
            playbackPending = false
            // Server control messages are serialized. Do not send new audio into the old turn.
            try await wire.sendControl(ClientControl(type: "abort", reason: "user_cancel"))
            if !ttsServerEnded { try await awaitOldTurnStop(owner: owner) }
            turnPending = false
        }
        guard owner == generation, isAccepted else { throw VoiceAudioError.notAccepted }
        try await wire.sendControl(ClientControl(type: "listen", mode: "start"))
        guard owner == generation, isAccepted else { throw VoiceAudioError.notAccepted }
        turnPending = true
        do {
            let stream = try capture.start()
            sequence = 0
            listening = true
            captureTask = Task { [weak self] in
                for await pcm in stream {
                    guard let self, self.generation == owner, self.listening, self.isAccepted else { break }
                    guard !pcm.isEmpty, pcm.count.isMultiple(of: 2) else { continue }
                    let frame = LYA1AudioCodec.Frame(codec: .pcmS16LE, sampleRateHz: 24_000,
                        channels: 1, sequence: self.sequence, payload: pcm)
                    self.sequence &+= 1
                    do { try await self.wire.sendAudio(LYA1AudioCodec.encode(frame)) }
                    catch { self.capture.stop(); self.listening = false; break }
                }
            }
        } catch {
            try? await wire.sendControl(ClientControl(type: "abort", reason: "user_cancel"))
            turnPending = false
            throw error
        }
    }

    func stopListening() async throws {
        guard isAccepted else { throw VoiceAudioError.notAccepted }
        guard listening else { return }
        capture.stop() // Finishes its stream after conversion/flush.
        await captureTask?.value // All queued PCM sends precede listen:stop.
        captureTask = nil
        listening = false
        try await wire.sendControl(ClientControl(type: "listen", mode: "stop"))
    }

    func receiveAudio(_ bytes: Data) throws {
        guard isAccepted else { throw VoiceAudioError.notAccepted }
        guard let format = negotiatedFormat("audio.output"), hasVoice else { throw VoiceAudioError.outputNotNegotiated }
        let frame = try LYA1AudioCodec.decode(bytes)
        guard format == VoiceCapabilityOffers.pcm,
              frame.codec == .pcmS16LE,
              frame.sampleRateHz == 24_000, frame.channels == 1,
              !frame.payload.isEmpty, frame.payload.count.isMultiple(of: 2) else {
            throw VoiceAudioError.incompatibleAudio
        }
        try playback.enqueue(frame.payload)
        playbackPending = true
    }

    func receiveServerControl(_ control: ServerVoiceControl) {
        guard isAccepted else { return }
        switch control.type {
        case "stt":
            transcript = control.text ?? ""
        case "tts":
            if control.state == "start" {
                activeTTSMessageID = control.messageId
                ttsServerEnded = false
                responseStatus = "Speaking"
            } else if control.state == "stop", control.messageId == activeTTSMessageID {
                ttsServerEnded = true
                playback.streamEnded() // Network end is not local playback completion.
                responseStatus = "Finishing playback"
                oldTurnWaiter?.resume()
                oldTurnWaiter = nil
            }
        case "error":
            responseStatus = control.message ?? control.code ?? "Realtime error"
        default: break
        }
    }

    func playbackDidFinish() {
        playbackPending = false
        if ttsServerEnded { responseStatus = "Playback completed" }
    }

    func cancel() async throws {
        guard isAccepted else { throw VoiceAudioError.notAccepted }
        listening = false
        capture.stop()
        playback.stop()
        playbackPending = false
        captureTask?.cancel()
        await captureTask?.value // No old send may be enqueued after the abort control.
        captureTask = nil
        turnPending = false
        try await wire.sendControl(ClientControl(type: "abort", reason: "user_cancel"))
    }

    func terminate() {
        generation &+= 1
        if listening || starting { capture.stop() }
        listening = false
        starting = false
        captureTask?.cancel()
        captureTask = nil
        playback.stop()
        playbackPending = false
        turnPending = false
        oldTurnWaiter?.resume(throwing: VoiceAudioError.notAccepted)
        oldTurnWaiter = nil
        accepted = nil
        hello = nil
        activeTTSMessageID = nil
        ttsServerEnded = true
    }

    private var hasVoice: Bool {
        accepted?.negotiatedCapabilities.contains(where: { $0.id == "realtime.voice" }) == true
    }

    private func negotiatedFormat(_ id: String) -> DeviceAudioFormat? {
        guard let selected = accepted?.negotiatedCapabilities.first(where: { $0.id == id }),
              let format = selected.format,
              hello?.availableCapabilities.first(where: { $0.id == id })?.formats?.contains(format) == true
        else { return nil }
        return format
    }

    private func awaitOldTurnStop(owner: Int) async throws {
        if ttsServerEnded { return }
        try await withCheckedThrowingContinuation { continuation in
            guard owner == generation, oldTurnWaiter == nil else {
                continuation.resume(throwing: VoiceAudioError.notAccepted)
                return
            }
            oldTurnWaiter = continuation
        }
    }
}
