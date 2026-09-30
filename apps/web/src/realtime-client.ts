import type { RealtimeAudioInput, RealtimeAudioOutput } from "../../../runtimes/realtime-device/src/audio-io";
import { binaryAudioCodec } from "../../../runtimes/realtime-device/src/binary-audio-codec";
import type { AudioFrame } from "../../../runtimes/realtime-device/src/protocol";
import { WebSocketTransport, type WebSocketLike } from "../../../runtimes/realtime-device/src/websocket-transport";
import { RealtimeAvatarController } from "./realtime-avatar-controller";
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
  private readonly socket: RealtimeClientSocket;
  private readonly transport: WebSocketTransport;
  private readonly avatarController: RealtimeAvatarController;
  private readonly input: RealtimeAudioInput;
  private readonly output: RealtimeAudioOutput;
  private removeMessage?: () => void;
  private removeAudio?: () => void;
  private removeClose?: () => void;
  private listening = false;
  private closed = false;
  private closePromise?: Promise<void>;
  private readonly onStateChange?: (state: RealtimeClientState) => void;
  private state: RealtimeClientState = "closed";

  private setState(state: RealtimeClientState): void {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange?.(state);
  }

  constructor(options: RealtimeClientOptions) {
    this.socket = options.socket ?? new BrowserWebSocket(options.url);
    this.transport = new WebSocketTransport(this.socket, binaryAudioCodec);
    this.input = options.input;
    this.output = options.output;
    this.avatarController = new RealtimeAvatarController({
      avatar: options.avatar,
    });
    this.onStateChange = options.onStateChange;

    this.removeMessage = this.transport.onMessage((message) => {
      this.avatarController.handleServerMessage(message);
      if (message.type === "tts" && message.state === "stop") {
        const epoch = this.avatarController.getPlaybackEpoch();
        void this.output.waitForIdle?.()
          .then(() => this.avatarController.handlePlaybackIdle(epoch))
          .catch(() => {});
      }
    });
    this.removeAudio = this.transport.onAudio((frame) => {
      this.avatarController.handleAudioFrame();
      void this.output.play(frame).catch(() => {});
    });
    this.removeClose = this.transport.onClose(() => {
      if (this.closed) return;
      this.closed = true;
      this.listening = false;
      this.setState("closed");
      this.removeMessage?.();
      this.removeAudio?.();
      this.removeClose?.();
      this.removeMessage = undefined;
      this.removeAudio = undefined;
      this.removeClose = undefined;
      this.avatarController.handleClosed();
      void this.input.stop().catch(() => {});
      void this.output.stop().catch(() => {});
    });

    this.sessionId = options.sessionId ?? createSessionId();
    this.deviceId = options.deviceId;
  }

  readonly sessionId: string;
  readonly deviceId?: string;

  async connect(): Promise<void> {
    if (this.closed) throw new Error("RealtimeClient is closed");
    this.setState("connecting");
    await this.socket.waitForOpen();
    if (this.closed) throw new Error("RealtimeClient is closed");
    await this.transport.send({
      type: "hello",
      version: 1,
      sessionId: this.sessionId,
      deviceId: this.deviceId,
      capabilities: ["audio.pcm_s16le", "avatar.dynamic"],
    });
    if (this.closed) throw new Error("RealtimeClient is closed");
    this.setState("connected");
  }

  async startListening(): Promise<void> {
    if (this.closed) throw new Error("RealtimeClient is closed");
    if (this.listening) return;
    await this.input.start((frame: AudioFrame) => void this.transport.sendAudio(frame));
    if (this.closed) {
      await this.input.stop();
      return;
    }
    await this.transport.send({
      type: "listen",
      mode: "start",
    });
    if (this.closed) {
      await this.input.stop();
      return;
    }
    this.listening = true;
  }

  async stopListening(): Promise<void> {
    if (this.closed) return;
    if (!this.listening) return;
    this.listening = false;
    if (this.closed) {
      await this.input.stop();
      return;
    }
    await this.transport.send({
      type: "listen",
      mode: "stop",
    });
    await this.input.stop();
  }

  async abort(): Promise<void> {
    if (this.closed) return;
    this.listening = false;
    await this.input.stop();
    await this.output.stop();
    this.avatarController.handleClosed();
    if (this.closed) return;
    await this.transport.send({
      type: "abort",
      reason: "user_cancel",
    });
  }

  async close(): Promise<void> {
    if (this.closePromise) {
      await this.closePromise;
      return;
    }

    this.closed = true;
    this.listening = false;
    this.setState("closed");

    this.removeMessage?.();
    this.removeAudio?.();
    this.removeClose?.();
    this.removeMessage = undefined;
    this.removeAudio = undefined;
    this.removeClose = undefined;

    this.closePromise = (async () => {
      await this.input.stop();
      await this.output.stop();
      await this.transport.close(1000, "client closed");
    })();

    await this.closePromise;
  }
}
