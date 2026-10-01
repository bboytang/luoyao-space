import Foundation

enum DeviceSessionContractError: Error {
    case invalidHello
    case invalidResponse
    case invalidTransition
}

struct DeviceIdentity: Codable, Equatable {
    let deviceId: String
    let platform: String
    var label: String? = nil
}

struct DeviceAudioFormat: Codable, Equatable {
    let codec: String
    let sampleRateHz: Int
    let channels: Int
}

struct CapabilityOffer: Codable, Equatable {
    let id: String
    var formats: [DeviceAudioFormat]? = nil
}

struct NegotiatedCapability: Codable, Equatable {
    let id: String
    var format: DeviceAudioFormat? = nil
}

struct DeviceHello: Codable, Equatable {
    let type: String
    let protocolVersions: [Int]
    let device: DeviceIdentity
    let supportedCapabilities: [CapabilityOffer]
    let availableCapabilities: [CapabilityOffer]

    static func ios(deviceId: String, supported: [CapabilityOffer] = [], available: [CapabilityOffer] = []) throws -> Self {
        let hello = Self(type: "device.hello", protocolVersions: [2],
                         device: DeviceIdentity(deviceId: deviceId, platform: "ios"),
                         supportedCapabilities: supported, availableCapabilities: available)
        try hello.validate()
        return hello
    }

    static func decode(_ data: Data) throws -> Self {
        let hello = try JSONDecoder().decode(Self.self, from: data)
        try hello.validate()
        return hello
    }

    func encode() throws -> Data {
        try validate()
        return try JSONEncoder().encode(self)
    }

    private func validate() throws {
        guard type == "device.hello", device.platform == "ios", !device.deviceId.trimmingCharacters(in: .whitespaces).isEmpty,
              !protocolVersions.isEmpty, protocolVersions.allSatisfy({ $0 > 0 }),
              Set(supportedCapabilities.map(\.id)).count == supportedCapabilities.count,
              Set(availableCapabilities.map(\.id)).count == availableCapabilities.count else {
            throw DeviceSessionContractError.invalidHello
        }
        for available in availableCapabilities {
            guard let supported = supportedCapabilities.first(where: { $0.id == available.id }),
                  (available.formats ?? []).allSatisfy({ supported.formats?.contains($0) == true }),
                  (available.formats == nil) == (supported.formats == nil) else {
                throw DeviceSessionContractError.invalidHello
            }
        }
    }
}

struct AcceptedDeviceSession: Codable, Equatable {
    let type: String
    let version: Int
    let transportSessionId: String
    let ownerConnectionId: String
    let negotiatedCapabilities: [NegotiatedCapability]
}

struct RejectedDeviceSession: Codable, Equatable {
    let type: String
    let reason: String
    let supportedVersions: [Int]
}

struct ClientControl: Codable, Equatable {
    let type: String
    var mode: String? = nil
    var reason: String? = nil
}

enum DeviceSessionState: String {
    case connecting
    case open
    case awaitingAdmission
    case accepted
    case rejected
    case disconnected
}

struct DeviceSessionMachine {
    let hello: DeviceHello
    private(set) var state: DeviceSessionState = .connecting
    private(set) var accepted: AcceptedDeviceSession?
    private(set) var rejection: RejectedDeviceSession?

    mutating func transportOpened() {
        if state == .connecting { state = .open }
    }

    mutating func helloSent() {
        if state == .open { state = .awaitingAdmission }
    }

    mutating func receive(_ data: Data) throws {
        guard state == .awaitingAdmission else { throw DeviceSessionContractError.invalidTransition }
        let envelope = try JSONDecoder().decode(MessageEnvelope.self, from: data)
        switch envelope.type {
        case "device.accepted":
            let response = try JSONDecoder().decode(AcceptedDeviceSession.self, from: data)
            guard response.version == 2, !response.transportSessionId.isEmpty, !response.ownerConnectionId.isEmpty,
                  Set(response.negotiatedCapabilities.map(\.id)).count == response.negotiatedCapabilities.count,
                  response.negotiatedCapabilities.allSatisfy({ negotiated in
                      guard let available = hello.availableCapabilities.first(where: { $0.id == negotiated.id }) else { return false }
                      if let format = negotiated.format { return available.formats?.contains(format) == true }
                      return available.formats == nil
                  }) else { throw DeviceSessionContractError.invalidResponse }
            accepted = response
            state = .accepted
        case "device.rejected":
            let response = try JSONDecoder().decode(RejectedDeviceSession.self, from: data)
            guard !response.reason.isEmpty, response.supportedVersions == [2] else {
                throw DeviceSessionContractError.invalidResponse
            }
            rejection = response
            state = .rejected
        default:
            throw DeviceSessionContractError.invalidResponse
        }
    }

    mutating func transportClosed() {
        if state != .rejected { state = .disconnected }
        accepted = nil
    }
}

private struct MessageEnvelope: Decodable { let type: String }
