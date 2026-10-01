import type {
  RealtimeControlMessage,
  RealtimeServerMessage,
  AudioFrame,
} from "./protocol";
import { TransportProtocolError, type TransportCodec } from "./transport";
import type { DeviceSessionHelloV2, DeviceSessionOutcomeV2 } from "../../../packages/protocol/src/device-session";

const SERVER_TYPES = new Set(["ready", "stt", "tts", "barge_in", "error", "pong", "device.accepted", "device.rejected"]);

export const jsonCodec: TransportCodec = {
  decodeControl(data: string): RealtimeServerMessage | DeviceSessionOutcomeV2 {
    let value: unknown;
    try {
      value = JSON.parse(data);
    } catch {
      throw new TransportProtocolError("Invalid JSON control message");
    }
    if (!value || typeof value !== "object") {
      throw new TransportProtocolError("Server message must be an object");
    }
    const message = value as Record<string, unknown>;
    if (typeof message.type !== "string" || !SERVER_TYPES.has(message.type)) {
      throw new TransportProtocolError("Unsupported server message type");
    }
    if (message.type === "device.accepted" &&
        (message.version !== 2 || typeof message.transportSessionId !== "string" ||
         typeof message.ownerConnectionId !== "string" || !Array.isArray(message.negotiatedCapabilities))) {
      throw new TransportProtocolError("Invalid accepted device session");
    }
    if (message.type === "device.rejected" &&
        (typeof message.reason !== "string" || !Array.isArray(message.supportedVersions))) {
      throw new TransportProtocolError("Invalid rejected device session");
    }
    return message as unknown as RealtimeServerMessage | DeviceSessionOutcomeV2;
  },

  encodeControl(message: RealtimeControlMessage | DeviceSessionHelloV2): string {
    return JSON.stringify(message);
  },

  decodeAudio(_data: Uint8Array): AudioFrame {
    throw new TransportProtocolError(
      "Audio framing is transport-specific and must be implemented by the adapter",
    );
  },

  encodeAudio(_frame: AudioFrame): Uint8Array {
    throw new TransportProtocolError(
      "Audio framing is transport-specific and must be implemented by the adapter",
    );
  },
};
