import type {
  RealtimeControlMessage,
  RealtimeServerMessage,
  AudioFrame,
} from "./protocol";
import { TransportProtocolError, type TransportCodec } from "./transport";

const CONTROL_TYPES = new Set(["hello", "listen", "abort", "ping"]);

export const jsonCodec: TransportCodec = {
  decodeControl(data: string): RealtimeControlMessage {
    let value: unknown;

    try {
      value = JSON.parse(data);
    } catch {
      throw new TransportProtocolError("Invalid JSON control message");
    }

    if (!value || typeof value !== "object") {
      throw new TransportProtocolError("Control message must be an object");
    }

    const message = value as Record<string, unknown>;

    if (typeof message.type !== "string" || !CONTROL_TYPES.has(message.type)) {
      throw new TransportProtocolError("Unsupported control message type");
    }

    if (message.type === "hello") {
      if (
        message.version !== 1 ||
        typeof message.sessionId !== "string" ||
        message.sessionId.trim().length === 0 ||
        (message.deviceId !== undefined &&
          (typeof message.deviceId !== "string" || message.deviceId.trim().length === 0)) ||
        (message.capabilities !== undefined &&
          (!Array.isArray(message.capabilities) ||
            message.capabilities.some((capability) => typeof capability !== "string"))) 
      ) {
        throw new TransportProtocolError("Invalid hello message");
      }
    }

    if (message.type === "listen") {
      if (message.mode !== "start" && message.mode !== "stop") {
        throw new TransportProtocolError("Invalid listen mode");
      }
    }

    if (message.type === "abort") {
      const reasons = new Set([
        "barge_in",
        "user_cancel",
        "session_shutdown",
        "system",
      ]);

      if (typeof message.reason !== "string" || !reasons.has(message.reason)) {
        throw new TransportProtocolError("Invalid abort reason");
      }
    }

    if (message.type === "ping" && typeof message.timestamp !== "string") {
      throw new TransportProtocolError("Invalid ping timestamp");
    }

    return message as unknown as RealtimeControlMessage;
  },

  encodeControl(message: RealtimeServerMessage): string {
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
