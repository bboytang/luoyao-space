import type { RealtimeAudioInput, RealtimeAudioOutput } from "../../../runtimes/realtime-device/src/audio-io";
import { binaryAudioCodec } from "../../../runtimes/realtime-device/src/binary-audio-codec";
import { RealtimeSession } from "../../../runtimes/realtime-device/src/realtime-session";
import { WebSocketTransport, type WebSocketLike } from "../../../runtimes/realtime-device/src/websocket-transport";
import { RealtimeAvatarController } from "../../../runtimes/realtime-device/src/realtime-avatar-controller";
import { AvatarRuntime } from "../../../runtimes/avatar/src/runtime";

export interface RealtimeClientSocket extends WebSocketLike {
  waitForOpen(): Promise<void>;
}

export type RealtimeClientState = "connecting" | "connected" | "closed";

export interface RealtimeClientOptions {
  url: string;
  socket?: RealtimeClientSocket;
  avatar: AvatarRuntime;
  input: RealtimeAudioInput;
  output: RealtimeAudioOutput;
  sessionId?: string;
  deviceId?: string;
  onStateChange?: (state: RealtimeClientState) => void;
}

export class BrowserWebSocket implements WebSocketLike {
  private readonly socket: WebSocket;

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.binaryType = "arraybuffer";
  }

  send(data: string | Uint8Array): void {
    this.socket.send(data);
  }

  close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }

  addEventListener(
    type: "message" | "close",
    listener:
      | ((event: { data: string | Uint8Array }) => void)
      | ((event: { code: number; reason: string; wasClean: boolean }) => void),
  ): void {
    if (type === "message") {
      this.socket.addEventListener("message", (event) => {
        const data = typeof event.data === "string"
          ? event.data
          : event.data instanceof ArrayBuffer
            ? new Uint8Array(event.data)
            : event.data;
        (listener as (event: { data: string | Uint8Array }) => void)({ data });
      });
      return;
    }

    this.socket.addEventListener("close", (event) => {
      (listener as (event: { code: number; reason: string; wasClean: boolean }) => void)({
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
    });
  }

  waitForOpen(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve(), { once: true });
      this.socket.addEventListener("error", () => reject(new Error("WebSocket connection failed")), {
        once: true,
      });
      this.socket.addEventListener("close", () => reject(new Error("WebSocket closed before opening")), {
        once: true,
      });
    });
  }
}

function createSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class RealtimeClient {
  private readonly session: RealtimeSession;
  readonly sessionId: string;
  readonly deviceId?: string;

  constructor(options: RealtimeClientOptions) {
    const socket = options.socket ?? new BrowserWebSocket(options.url);
    const transport = new WebSocketTransport(socket, binaryAudioCodec);
    const avatarController = new RealtimeAvatarController(options.avatar);

    this.sessionId = options.sessionId ?? createSessionId();
    this.deviceId = options.deviceId;

    this.session = new RealtimeSession({
      transport,
      input: options.input,
      output: options.output,
      avatar: avatarController,
      sessionId: this.sessionId,
      deviceId: this.deviceId,
      onStateChange: options.onStateChange,
    });
  }

  async connect(): Promise<void> {
    await this.session.connect();
  }

  async startListening(): Promise<void> {
    await this.session.startListening();
  }

  async stopListening(): Promise<void> {
    await this.session.stopListening();
  }

  async abort(): Promise<void> {
    await this.session.abort();
  }

  async interruptResponse(): Promise<void> {
    await this.session.interruptResponse();
  }

  async close(): Promise<void> {
    await this.session.close();
  }
}
