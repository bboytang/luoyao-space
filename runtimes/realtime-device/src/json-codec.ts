import type {
  RealtimeControlMessage,
  RealtimeServerMessage,
  AudioFrame,
} from "./protocol";
import { TransportProtocolError, type TransportCodec } from "./transport";

const SERVER_TYPES = new Set(["ready", "stt", "tts", "error", "pong"]);

export const jsonCodec: TransportCodec = {
  decodeControl(data: string): RealtimeServerMessage {
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
    return message as unknown as RealtimeServerMessage;
  },

  encodeControl(message: RealtimeControlMessage): string {
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
