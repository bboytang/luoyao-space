import Foundation
import XCTest
@testable import LuoyaoIOS

@MainActor final class VoiceAudioLogicTests: XCTestCase {
    private let format = DeviceAudioFormat(codec: "pcm_s16le", sampleRateHz: 24_000, channels: 1)

    private func session(input: Bool = true, output: Bool = true) throws -> (DeviceHello, AcceptedDeviceSession) {
        let inputOffer = CapabilityOffer(id: "audio.input", formats: [format])
        let outputOffer = CapabilityOffer(id: "audio.output", formats: [format])
        let voice = CapabilityOffer(id: "realtime.voice")
        let available = [voice] + (input ? [inputOffer] : []) + (output ? [outputOffer] : [])
        let hello = try DeviceHello.ios(deviceId: "ios-device", supported: [voice, inputOffer, outputOffer], available: available)
        let negotiated = [NegotiatedCapability(id: "realtime.voice")]
            + (input ? [NegotiatedCapability(id: "audio.input", format: format)] : [])
            + (output ? [NegotiatedCapability(id: "audio.output", format: format)] : [])
        return (hello, AcceptedDeviceSession(type: "device.accepted", version: 2,
            transportSessionId: "transport-1", ownerConnectionId: "connection-1",
            negotiatedCapabilities: negotiated))
    }

    func testPCMFloatBoundaryProducesLittleEndianSigned16() throws {
        XCTAssertEqual(PCM16.pack(samples: [-1, 0, 1]), Data([0x00, 0x80, 0x00, 0x00, 0xff, 0x7f]))
        let decoded = try PCM16.unpack(Data([0x00, 0x80, 0xff, 0x7f]))
        XCTAssertEqual(decoded.count, 2)
        XCTAssertEqual(decoded[0], -1, accuracy: 0.0001)
        XCTAssertEqual(decoded[1], 1, accuracy: 0.0001)
        XCTAssertThrowsError(try PCM16.unpack(Data([0x01])))
    }

    func testCapabilityOffersKeepPermissionAndRouteSeparateFromSupport() throws {
        XCTAssertEqual(VoiceCapabilityOffers.supported.map(\.id), ["realtime.voice", "audio.input", "audio.output"])
        XCTAssertEqual(VoiceCapabilityOffers.available(input: false, output: true).map(\.id), ["audio.output"])
        XCTAssertEqual(VoiceCapabilityOffers.available(input: true, output: false).map(\.id), ["audio.input"])
        XCTAssertEqual(VoiceCapabilityOffers.available(input: true, output: true).map(\.id),
                       ["realtime.voice", "audio.input", "audio.output"])
        let hello = try DeviceHello.ios(deviceId: "ios-device", supported: VoiceCapabilityOffers.supported,
            available: VoiceCapabilityOffers.available(input: false, output: true))
        XCTAssertEqual(hello.device.platform, "ios")
        XCTAssertFalse(hello.availableCapabilities.contains { $0.id == "audio.input" })
    }

    func testNewTurnCancelsPriorProcessingEvenBeforeTTSStarts() async throws {
        let capture = FakeCapture()
        let wire = FakeWire()
        let controller = VoiceTurnController(capture: capture, playback: FakePlayback(), wire: wire)
        let (hello, accepted) = try session()
        controller.admit(accepted, hello: hello)
        try await controller.startListening()
        try await controller.stopListening()
        try await controller.startListening()
        XCTAssertEqual(wire.controls, [
            ClientControl(type: "listen", mode: "start"),
            ClientControl(type: "listen", mode: "stop"),
            ClientControl(type: "abort", reason: "user_cancel"),
            ClientControl(type: "listen", mode: "start"),
        ])
        try await controller.stopListening()
    }

    func testAcceptedAndNegotiatedInputGateWithPermissionDenied() async throws {
        let capture = FakeCapture()
        let playback = FakePlayback()
        let wire = FakeWire()
        let controller = VoiceTurnController(capture: capture, playback: playback, wire: wire)
        await XCTAssertThrowsAsync { try await controller.startListening() }
        let (hello, accepted) = try session(input: false)
        controller.admit(accepted, hello: hello)
        XCTAssertTrue(controller.isAccepted)
        await XCTAssertThrowsAsync { try await controller.startListening() }
        XCTAssertEqual(capture.starts, 0)
        XCTAssertTrue(wire.controls.isEmpty)
    }

    func testPushToTalkOrderingSequenceAndIdempotentStop() async throws {
        let capture = FakeCapture()
        let playback = FakePlayback()
        let wire = FakeWire()
        let controller = VoiceTurnController(capture: capture, playback: playback, wire: wire)
        let (hello, accepted) = try session()
        controller.admit(accepted, hello: hello)
        try await controller.startListening()
        try await controller.startListening()
        XCTAssertEqual(capture.starts, 1)
        XCTAssertEqual(wire.controls, [ClientControl(type: "listen", mode: "start")])
        capture.emit(Data([0x01, 0x00]))
        capture.emit(Data([0x02, 0x00]))
        try await controller.stopListening()
        try await controller.stopListening()
        XCTAssertEqual(capture.stops, 1)
        XCTAssertEqual(wire.controls, [ClientControl(type: "listen", mode: "start"), ClientControl(type: "listen", mode: "stop")])
        XCTAssertEqual(try wire.audio.map { try LYA1AudioCodec.decode($0).sequence }, [0, 1])
        XCTAssertEqual(try wire.audio.map { try LYA1AudioCodec.decode($0).payload }, [Data([1, 0]), Data([2, 0])])
    }

    func testStaleCaptureCannotWriteAfterTerminationOrReconnect() async throws {
        let capture = FakeCapture()
        let playback = FakePlayback()
        let wire = FakeWire()
        let controller = VoiceTurnController(capture: capture, playback: playback, wire: wire)
        let (hello, accepted) = try session()
        controller.admit(accepted, hello: hello)
        try await controller.startListening()
        let old = capture.continuation
        controller.terminate()
        controller.admit(accepted, hello: hello)
        old?.yield(Data([1, 0]))
        try await controller.startListening()
        capture.emit(Data([2, 0]))
        try await controller.stopListening()
        XCTAssertEqual(wire.audio.count, 1)
        XCTAssertEqual(try LYA1AudioCodec.decode(wire.audio[0]).sequence, 0)
    }

    func testInboundAudioRejectsMalformedIncompatibleAndStaleFrames() throws {
        let capture = FakeCapture()
        let playback = FakePlayback()
        let wire = FakeWire()
        let controller = VoiceTurnController(capture: capture, playback: playback, wire: wire)
        let (hello, accepted) = try session()
        controller.admit(accepted, hello: hello)
        let valid = try LYA1AudioCodec.encode(.init(codec: .pcmS16LE, sampleRateHz: 24_000,
            channels: 1, sequence: 0, payload: Data([1, 0])))
        try controller.receiveAudio(valid)
        XCTAssertEqual(playback.buffers, [Data([1, 0])])
        XCTAssertThrowsError(try controller.receiveAudio(Data([0])))
        let wrong = try LYA1AudioCodec.encode(.init(codec: .pcmS16LE, sampleRateHz: 16_000,
            channels: 1, sequence: 1, payload: Data([1, 0])))
        XCTAssertThrowsError(try controller.receiveAudio(wrong))
        controller.terminate()
        XCTAssertThrowsError(try controller.receiveAudio(valid))
        XCTAssertEqual(playback.buffers.count, 1)
    }

    func testUnnegotiatedOutputNeverStartsPlayback() throws {
        let playback = FakePlayback()
        let controller = VoiceTurnController(capture: FakeCapture(), playback: playback, wire: FakeWire())
        let (hello, accepted) = try session(output: false)
        controller.admit(accepted, hello: hello)
        let frame = try LYA1AudioCodec.encode(.init(codec: .pcmS16LE, sampleRateHz: 24_000,
            channels: 1, sequence: 0, payload: Data([1, 0])))
        XCTAssertThrowsError(try controller.receiveAudio(frame))
        XCTAssertTrue(playback.buffers.isEmpty)
    }

    func testPlaybackStopCancelAndServerEndAreSeparate() async throws {
        let capture = FakeCapture()
        let playback = FakePlayback()
        let wire = FakeWire()
        let controller = VoiceTurnController(capture: capture, playback: playback, wire: wire)
        let (hello, accepted) = try session()
        controller.admit(accepted, hello: hello)
        let data = try LYA1AudioCodec.encode(.init(codec: .pcmS16LE, sampleRateHz: 24_000,
            channels: 1, sequence: 0, payload: Data([1, 0])))
        try controller.receiveAudio(data)
        controller.receiveServerControl(ServerVoiceControl(type: "tts", state: "stop"))
        XCTAssertEqual(playback.endSignals, 1)
        XCTAssertEqual(playback.stops, 0) // Receipt of tts:stop is not playback completion.
        XCTAssertEqual(controller.responseStatus, "Finishing playback")
        controller.playbackDidFinish()
        XCTAssertEqual(controller.responseStatus, "Playback completed")
        try await controller.cancel()
        XCTAssertEqual(playback.stops, 1)
        XCTAssertEqual(wire.controls.last, ClientControl(type: "abort", reason: "user_cancel"))
        controller.terminate()
        XCTAssertEqual(playback.stops, 2)
    }

    func testPTTDuringTTSWaitsForOldTurnStopBeforeNewListen() async throws {
        let capture = FakeCapture()
        let playback = FakePlayback()
        let wire = FakeWire()
        let controller = VoiceTurnController(capture: capture, playback: playback, wire: wire)
        let (hello, accepted) = try session()
        controller.admit(accepted, hello: hello)
        controller.receiveServerControl(ServerVoiceControl(type: "tts", state: "start", messageId: "message-1"))
        try controller.receiveAudio(LYA1AudioCodec.encode(.init(codec: .pcmS16LE,
            sampleRateHz: 24_000, channels: 1, sequence: 0, payload: Data([1, 0]))))
        let abortSent = expectation(description: "old turn abort sent")
        wire.onControl = { abortSent.fulfill() }
        let restart = Task { try await controller.startListening() }
        await fulfillment(of: [abortSent], timeout: 2)
        XCTAssertEqual(playback.stops, 1)
        XCTAssertEqual(wire.controls, [ClientControl(type: "abort", reason: "user_cancel")])
        XCTAssertEqual(capture.starts, 0)
        controller.receiveServerControl(ServerVoiceControl(type: "tts", state: "stop", messageId: "message-1"))
        try await restart.value
        XCTAssertEqual(wire.controls.last, ClientControl(type: "listen", mode: "start"))
        XCTAssertEqual(capture.starts, 1)
        try await controller.stopListening()
    }
}

@MainActor private final class FakeCapture: VoiceCapture {
    var starts = 0
    var stops = 0
    var continuation: AsyncStream<Data>.Continuation?
    func start() throws -> AsyncStream<Data> {
        starts += 1
        return AsyncStream { self.continuation = $0 }
    }
    func emit(_ data: Data) { continuation?.yield(data) }
    func stop() { stops += 1; continuation?.finish() }
}

@MainActor private final class FakePlayback: VoicePlayback {
    var buffers: [Data] = []
    var stops = 0
    var endSignals = 0
    func enqueue(_ data: Data) throws { buffers.append(data) }
    func streamEnded() { endSignals += 1 }
    func stop() { stops += 1 }
}

@MainActor private final class FakeWire: VoiceWire {
    var controls: [ClientControl] = []
    var audio: [Data] = []
    var onControl: (() -> Void)?
    func sendControl(_ control: ClientControl) async throws {
        controls.append(control)
        onControl?()
        onControl = nil
    }
    func sendAudio(_ data: Data) async throws { audio.append(data) }
}

@MainActor private func XCTAssertThrowsAsync(_ body: () async throws -> Void,
                                  file: StaticString = #filePath, line: UInt = #line) async {
    do { try await body(); XCTFail("Expected error", file: file, line: line) }
    catch { }
}
