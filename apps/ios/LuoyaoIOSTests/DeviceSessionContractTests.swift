import Foundation
import XCTest
@testable import LuoyaoIOS

final class DeviceSessionContractTests: XCTestCase {
    private func fixture() throws -> [String: Any] {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "m2-wire-fixtures", withExtension: "json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    private func object(_ value: Any?) throws -> [String: Any] { try XCTUnwrap(value as? [String: Any]) }

    func testIOSHelloAndAdmissionFollowSharedFixture() throws {
        let voice = try object(fixture()["voice"])
        let expectedHello = try object(voice["hello"])
        let hello = try DeviceHello.decode(JSONSerialization.data(withJSONObject: expectedHello))
        XCTAssertEqual(hello.device.platform, "ios")
        XCTAssertEqual(hello.protocolVersions, [2])
        XCTAssertTrue(NSDictionary(dictionary: try object(JSONSerialization.jsonObject(with: hello.encode()))).isEqual(to: expectedHello))
        var machine = DeviceSessionMachine(hello: hello)
        machine.transportOpened()
        XCTAssertEqual(machine.state, .open)
        machine.helloSent()
        XCTAssertEqual(machine.state, .awaitingAdmission)
        let accepted = try object(voice["accepted"])
        try machine.receive(JSONSerialization.data(withJSONObject: accepted))
        XCTAssertEqual(machine.state, .accepted)
        XCTAssertEqual(machine.accepted?.transportSessionId, "transport-1")
        XCTAssertEqual(machine.accepted?.negotiatedCapabilities.map(\.id), ["realtime.voice", "audio.input", "audio.output"])
        XCTAssertFalse(machine.accepted!.negotiatedCapabilities.contains { $0.id == "avatar.dynamic" })
    }

    func testRejectionNeverBecomesOperational() throws {
        let unsupported = try object(fixture()["unsupportedVersion"])
        let hello = try DeviceHello.decode(JSONSerialization.data(withJSONObject: object(unsupported["hello"])))
        var machine = DeviceSessionMachine(hello: hello)
        machine.transportOpened()
        machine.helloSent()
        try machine.receive(JSONSerialization.data(withJSONObject: object(unsupported["rejected"])))
        XCTAssertEqual(machine.state, .rejected)
        XCTAssertEqual(machine.rejection?.reason, "unsupported_version")
        XCTAssertEqual(machine.rejection?.supportedVersions, [2])
        XCTAssertNil(machine.accepted)
    }

    func testNoAudioAndNoAvatarSessionIsValid() throws {
        let headless = try object(fixture()["headless"])
        var hello = try object(headless["hello"])
        hello["device"] = ["deviceId": "ios-device-1", "platform": "ios"]
        let iosHello = try DeviceHello.decode(JSONSerialization.data(withJSONObject: hello))
        XCTAssertTrue(iosHello.supportedCapabilities.isEmpty)
        XCTAssertTrue(iosHello.availableCapabilities.isEmpty)
        var machine = DeviceSessionMachine(hello: iosHello)
        machine.transportOpened()
        machine.helloSent()
        try machine.receive(JSONSerialization.data(withJSONObject: object(headless["accepted"])))
        XCTAssertEqual(machine.state, .accepted)
        XCTAssertTrue(machine.accepted!.negotiatedCapabilities.isEmpty)
    }

    func testControlsSerializeFromSharedFixture() throws {
        let controls = try XCTUnwrap(fixture()["clientControls"] as? [[String: Any]])
        for expected in controls {
            let control = try JSONDecoder().decode(ClientControl.self, from: JSONSerialization.data(withJSONObject: expected))
            let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(control))
            XCTAssertTrue(NSDictionary(dictionary: try object(encoded)).isEqual(to: expected))
        }
    }

    func testPCMFrameMatchesSharedGoldenBytes() throws {
        let binary = try object(fixture()["binaryAudio"])
        let valid = try object(binary["valid"])
        let golden = try Data(hex: XCTUnwrap(valid["hex"] as? String))
        let frame = try LYA1AudioCodec.decode(golden)
        XCTAssertEqual(frame.codec, .pcmS16LE)
        XCTAssertEqual(frame.sampleRateHz, 24_000)
        XCTAssertEqual(frame.channels, 1)
        XCTAssertEqual(frame.sequence, 42)
        XCTAssertEqual(frame.payload, try Data(hex: XCTUnwrap(valid["payloadHex"] as? String)))
        XCTAssertEqual(try LYA1AudioCodec.encode(frame), golden)
        for malformed in try XCTUnwrap(binary["malformed"] as? [[String: Any]]) {
            XCTAssertThrowsError(try LYA1AudioCodec.decode(Data(hex: XCTUnwrap(malformed["hex"] as? String))))
        }
    }

    func testTransportOpenAndHelloDoNotAuthorizeUse() throws {
        let hello = try DeviceHello.ios(deviceId: "ios-test")
        var machine = DeviceSessionMachine(hello: hello)
        machine.transportOpened()
        XCTAssertNotEqual(machine.state, .accepted)
        machine.helloSent()
        XCTAssertNotEqual(machine.state, .accepted)
        machine.transportClosed()
        XCTAssertEqual(machine.state, .disconnected)
        XCTAssertNil(machine.accepted)
    }

    func testServerCannotNegotiateUndeclaredCapability() throws {
        let hello = try DeviceHello.ios(deviceId: "ios-test")
        var machine = DeviceSessionMachine(hello: hello)
        machine.transportOpened()
        machine.helloSent()
        let unexpected: [String: Any] = ["type": "device.accepted", "version": 2,
            "transportSessionId": "transport-1", "ownerConnectionId": "connection-1",
            "negotiatedCapabilities": [["id": "audio.input", "format":
                ["codec": "pcm_s16le", "sampleRateHz": 24000, "channels": 1]]]]
        XCTAssertThrowsError(try machine.receive(JSONSerialization.data(withJSONObject: unexpected)))
        XCTAssertNotEqual(machine.state, .accepted)
    }

    func testStableDeviceIDIsPersistenceNotAuthentication() {
        let suite = "space.luoyao.ios-tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let first = DeviceIDStore(defaults: defaults).loadOrCreate()
        XCTAssertFalse(first.isEmpty)
        XCTAssertEqual(DeviceIDStore(defaults: defaults).loadOrCreate(), first)
    }
}

private extension Data {
    init(hex: String) throws {
        guard hex.count.isMultiple(of: 2) else { throw LYA1AudioError.malformedFrame }
        var bytes: [UInt8] = []
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<next], radix: 16) else { throw LYA1AudioError.malformedFrame }
            bytes.append(byte)
            index = next
        }
        self.init(bytes)
    }
}
