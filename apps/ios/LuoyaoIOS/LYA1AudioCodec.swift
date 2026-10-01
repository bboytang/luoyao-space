import Foundation

enum LYA1AudioError: Error {
    case malformedFrame
    case invalidMetadata
}

enum LYA1AudioCodec {
    enum Codec: UInt8 { case opus = 1, pcmS16LE = 2 }

    struct Frame: Equatable {
        let codec: Codec
        let sampleRateHz: UInt32
        let channels: UInt8
        let sequence: UInt32
        let payload: Data
    }

    private static let magic: [UInt8] = [0x4c, 0x59, 0x41, 0x31]
    private static let headerLength = 18

    static func decode(_ data: Data) throws -> Frame {
        let bytes = [UInt8](data)
        guard bytes.count >= headerLength, Array(bytes.prefix(4)) == magic,
              let codec = Codec(rawValue: bytes[4]) else { throw LYA1AudioError.malformedFrame }
        let sampleRate = readUInt32(bytes, at: 5)
        let channels = bytes[9]
        let sequence = readUInt32(bytes, at: 10)
        let length = readUInt32(bytes, at: 14)
        guard sampleRate > 0, channels > 0, Int(length) == bytes.count - headerLength else {
            throw LYA1AudioError.malformedFrame
        }
        return Frame(codec: codec, sampleRateHz: sampleRate, channels: channels,
                     sequence: sequence, payload: Data(bytes.dropFirst(headerLength)))
    }

    static func encode(_ frame: Frame) throws -> Data {
        guard frame.sampleRateHz > 0, frame.channels > 0, frame.payload.count <= Int(UInt32.max) else {
            throw LYA1AudioError.invalidMetadata
        }
        var bytes = magic
        bytes.append(frame.codec.rawValue)
        appendUInt32(frame.sampleRateHz, to: &bytes)
        bytes.append(frame.channels)
        appendUInt32(frame.sequence, to: &bytes)
        appendUInt32(UInt32(frame.payload.count), to: &bytes)
        bytes.append(contentsOf: frame.payload)
        return Data(bytes)
    }

    private static func readUInt32(_ bytes: [UInt8], at offset: Int) -> UInt32 {
        (UInt32(bytes[offset]) << 24) | (UInt32(bytes[offset + 1]) << 16) |
        (UInt32(bytes[offset + 2]) << 8) | UInt32(bytes[offset + 3])
    }

    private static func appendUInt32(_ value: UInt32, to bytes: inout [UInt8]) {
        bytes.append(UInt8((value >> 24) & 0xff))
        bytes.append(UInt8((value >> 16) & 0xff))
        bytes.append(UInt8((value >> 8) & 0xff))
        bytes.append(UInt8(value & 0xff))
    }
}
