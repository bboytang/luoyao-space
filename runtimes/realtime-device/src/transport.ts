import type {
  AudioFrame,
  RealtimeControlMessage,
  RealtimeServerMessage,
} from "./protocol";

export interface RealtimeTransport {
  send(message: RealtimeControlMessage): Promise<void>;
  sendAudio(frame: AudioFrame): Promise<void>;
  close(code?: number, reason?: string): Promise<void>;
  onMessage(handler: (message: RealtimeServerMessage) => void | Promise<void>): () => void;
  onAudio(handler: (frame: AudioFrame) => void | Promise<void>): () => void;
  onClose(handler: (event: TransportCloseEvent) => void): () => void;
}

export interface TransportCloseEvent {
  code: number;
  reason: string;
  wasClean: boolean;
}

export interface TransportCodec {
  decodeControl(data: string): RealtimeServerMessage;
  encodeControl(message: RealtimeControlMessage): string;
  decodeAudio(data: Uint8Array): AudioFrame;
  encodeAudio(frame: AudioFrame): Uint8Array;
}

export class TransportProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransportProtocolError";
  }
}
