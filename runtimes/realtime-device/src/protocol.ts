export type RealtimeSessionState =
  | "connecting"
  | "ready"
  | "listening"
  | "processing"
  | "speaking"
  | "aborting"
  | "closing"
  | "closed";

export type RealtimeControlMessage =
  | HelloMessage
  | ListenMessage
  | AbortMessage
  | PingMessage;

export interface HelloMessage {
  type: "hello";
  version: 1;
  sessionId: string;
  deviceId?: string;
  capabilities?: string[];
}

export interface ListenMessage {
  type: "listen";
  mode: "start" | "stop";
  conversationId?: string;
}

export interface AbortMessage {
  type: "abort";
  reason: "barge_in" | "user_cancel" | "session_shutdown" | "system";
}

export interface PingMessage {
  type: "ping";
  timestamp: string;
}

export type RealtimeServerMessage =
  | ReadyMessage
  | SttMessage
  | TtsStartMessage
  | TtsSentenceMessage
  | TtsStopMessage
  | ErrorMessage
  | PongMessage;

export interface ReadyMessage {
  type: "ready";
  sessionId: string;
  state: "ready";
  serverTime: string;
}

export interface SttMessage {
  type: "stt";
  text: string;
  final: boolean;
}

export interface TtsStartMessage {
  type: "tts";
  state: "start";
  messageId: string;
}

export interface TtsSentenceMessage {
  type: "tts";
  state: "sentence_start";
  messageId: string;
  sentence: string;
  index: number;
}

export interface TtsStopMessage {
  type: "tts";
  state: "stop";
  messageId: string;
}

export interface ErrorMessage {
  type: "error";
  code: string;
  message: string;
  retryable: boolean;
}

export interface PongMessage {
  type: "pong";
  timestamp: string;
}

export interface AudioFrame {
  kind: "audio";
  codec: "opus" | "pcm_s16le";
  sampleRate: number;
  channels: number;
  sequence: number;
  payload: Uint8Array;
}

export function isControlMessage(value: unknown): value is RealtimeControlMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return (
    message.type === "hello" ||
    message.type === "listen" ||
    message.type === "abort" ||
    message.type === "ping"
  );
}
