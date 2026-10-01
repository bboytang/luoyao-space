import AVFoundation
import Foundation

@MainActor final class NativeAudioSessionManager {
    private let session = AVAudioSession.sharedInstance()
    private var interruptionObserver: NSObjectProtocol?
    private var routeObserver: NSObjectProtocol?
    var onHardwareChange: (() -> Void)?

    init() {
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: session, queue: nil
        ) { [weak self] _ in
            Task { @MainActor in self?.onHardwareChange?() }
        }
        routeObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: session, queue: nil
        ) { [weak self] _ in
            Task { @MainActor in self?.onHardwareChange?() }
        }
    }

    var microphoneStatus: String {
        switch session.recordPermission {
        case .granted: return "Microphone allowed"
        case .denied: return "Microphone denied; voice input unavailable"
        case .undetermined: return "Microphone permission not requested"
        @unknown default: return "Microphone permission unknown"
        }
    }

    func requestMicrophonePermission() async -> Bool {
        if session.recordPermission == .granted { return true }
        if session.recordPermission == .denied { return false }
        return await withCheckedContinuation { continuation in
            session.requestRecordPermission { granted in continuation.resume(returning: granted) }
        }
    }

    /// Failure affects offered availability, not Device Session validity.
    func activate() throws {
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker])
        try session.setActive(true)
    }

    func capabilities() -> (input: Bool, output: Bool) {
        let output = session.outputNumberOfChannels > 0 && !session.currentRoute.outputs.isEmpty
        let input = session.recordPermission == .granted && session.isInputAvailable
        return (input, output)
    }

    func deactivate() {
        try? session.setActive(false, options: [.notifyOthersOnDeactivation])
    }

    func removeObservers() {
        if let interruptionObserver { NotificationCenter.default.removeObserver(interruptionObserver) }
        if let routeObserver { NotificationCenter.default.removeObserver(routeObserver) }
        interruptionObserver = nil
        routeObserver = nil
    }
}

/// Hardware format is intentionally unconstrained; AVAudioConverter owns resampling/downmixing.
final class NativeMicrophoneCapture: VoiceCapture {
    private let engine = AVAudioEngine()
    private let lock = NSLock()
    private var converter: AVAudioConverter?
    private var continuation: AsyncStream<Data>.Continuation?
    private var active = false

    @MainActor func start() throws -> AsyncStream<Data> {
        lock.lock()
        let alreadyActive = active
        lock.unlock()
        if alreadyActive { throw VoiceAudioError.incompatibleAudio }
        let input = engine.inputNode
        let hardware = input.outputFormat(forBus: 0)
        guard hardware.sampleRate > 0, hardware.channelCount > 0,
              let normalized = AVAudioFormat(standardFormatWithSampleRate: 24_000, channels: 1),
              let converter = AVAudioConverter(from: hardware, to: normalized) else {
            throw VoiceAudioError.incompatibleAudio
        }
        var streamContinuation: AsyncStream<Data>.Continuation!
        let stream = AsyncStream<Data> { streamContinuation = $0 }
        lock.lock()
        self.converter = converter
        continuation = streamContinuation
        active = true
        lock.unlock()
        input.installTap(onBus: 0, bufferSize: 1024, format: hardware) { [weak self] buffer, _ in
            self?.convert(buffer)
        }
        do {
            engine.prepare()
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            stop()
            throw error
        }
        return stream
    }

    @MainActor func stop() {
        lock.lock()
        let wasActive = active
        lock.unlock()
        guard wasActive else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        lock.lock()
        if let converter {
            // Drain converter latency before listen:stop. No old tap may append after this point.
            for _ in 0..<8 {
                guard let output = AVAudioPCMBuffer(pcmFormat: converter.outputFormat, frameCapacity: 2048) else { break }
                var error: NSError?
                let status = converter.convert(to: output, error: &error) { _, inputStatus in
                    inputStatus.pointee = .endOfStream
                    return nil
                }
                yieldNormalized(output)
                if error != nil || status != .haveData || output.frameLength == 0 { break }
            }
        }
        active = false
        converter = nil
        continuation?.finish()
        continuation = nil
        lock.unlock()
    }

    private func convert(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        defer { lock.unlock() }
        guard active, let converter else { return }
        let estimate = Int((Double(buffer.frameLength) * 24_000 / converter.inputFormat.sampleRate).rounded(.up)) + 256
        guard let output = AVAudioPCMBuffer(pcmFormat: converter.outputFormat,
                                           frameCapacity: AVAudioFrameCount(estimate)) else { return }
        var supplied = false
        var error: NSError?
        _ = converter.convert(to: output, error: &error) { _, inputStatus in
            if supplied {
                inputStatus.pointee = .noDataNow
                return nil
            }
            supplied = true
            inputStatus.pointee = .haveData
            return buffer
        }
        if error == nil { yieldNormalized(output) }
    }

    /// Call only while lock is held.
    private func yieldNormalized(_ buffer: AVAudioPCMBuffer) {
        guard buffer.frameLength > 0, let samples = buffer.floatChannelData?.pointee else { return }
        let values = Array(UnsafeBufferPointer(start: samples, count: Int(buffer.frameLength)))
        continuation?.yield(PCM16.pack(samples: values))
    }
}

/// .dataPlayedBack, not network arrival or queue insertion, drives local completion.
@MainActor final class NativePCMPlayback: VoicePlayback {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let format = AVAudioFormat(standardFormatWithSampleRate: 24_000, channels: 1)!
    private var configured = false
    private var pending = 0
    private var ended = false
    private var generation = 0
    var onPlayedBack: (() -> Void)?

    func enqueue(_ data: Data) throws {
        let samples = try PCM16.unpack(data)
        guard samples.count <= Int(UInt32.max),
              let buffer = AVAudioPCMBuffer(pcmFormat: format,
                                            frameCapacity: AVAudioFrameCount(samples.count)),
              let channel = buffer.floatChannelData?.pointee else {
            throw VoiceAudioError.incompatibleAudio
        }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        for index in samples.indices { channel[index] = samples[index] }
        if !configured {
            engine.attach(player)
            engine.connect(player, to: engine.mainMixerNode, format: format)
            configured = true
        }
        if !engine.isRunning { try engine.start() }
        let owner = generation
        pending += 1
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.generation == owner else { return }
                self.pending -= 1
                self.signalIfFinished()
            }
        }
        if !player.isPlaying { player.play() }
    }

    func streamEnded() {
        ended = true
        signalIfFinished()
    }

    func stop() {
        generation &+= 1
        player.stop() // Unschedules buffers; callbacks from this generation are ignored.
        engine.stop()
        pending = 0
        ended = false
    }

    private func signalIfFinished() {
        if ended && pending == 0 {
            ended = false
            onPlayedBack?()
        }
    }
}
