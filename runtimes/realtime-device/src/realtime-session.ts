import type { RealtimeAudioInput, RealtimeAudioOutput } from "./audio-io";
import type { AudioFrame, RealtimeServerMessage } from "./protocol";
import type { RealtimeTransport } from "./transport";
import { DEFAULT_REALTIME_CAPABILITIES, type RealtimeCapability } from "./capabilities";

export type RealtimeSessionState = "connecting" | "connected" | "closed";

export interface RealtimeAvatarControllerPort {
  handleServerMessage(message: RealtimeServerMessage): void;
  handleAudioFrame(): void;
  getPlaybackEpoch(): number;
  handlePlaybackIdle(epoch: number): void;
  handleClosed(): void;
}

export interface RealtimeSessionOptions {
  transport: RealtimeTransport;
  input: RealtimeAudioInput;
  output: RealtimeAudioOutput;
  avatar: RealtimeAvatarControllerPort;
  sessionId: string;
  deviceId?: string;
  capabilities?: RealtimeCapability[];
  onStateChange?: (state: RealtimeSessionState) => void;
}

export class RealtimeSession {
  private readonly transport: RealtimeTransport;
  private readonly input: RealtimeAudioInput;
  private readonly output: RealtimeAudioOutput;
  private readonly avatar: RealtimeAvatarControllerPort;
  private readonly deviceId?: string;
  private readonly capabilities?: string[];
  private readonly onStateChange?: (state: RealtimeSessionState) => void;
  private readonly sessionId: string;
  private removeMessage?: () => void;
  private removeAudio?: () => void;
  private removeClose?: () => void;
  private listening = false;
  private closed = false;
  private closePromise?: Promise<void>;
  private state: RealtimeSessionState = "closed";

  constructor(options: RealtimeSessionOptions) {
    this.transport = options.transport;
    this.input = options.input;
    this.output = options.output;
    this.avatar = options.avatar;
    this.sessionId = options.sessionId;
    this.deviceId = options.deviceId;
    this.capabilities = options.capabilities ?? DEFAULT_REALTIME_CAPABILITIES;
    this.onStateChange = options.onStateChange;

    this.removeMessage = this.transport.onMessage((message) => {
      this.avatar.handleServerMessage(message);
      if (message.type === "tts" && message.state === "stop") {
        const epoch = this.avatar.getPlaybackEpoch();
        void this.output.waitForIdle?.()
          .then(() => this.avatar.handlePlaybackIdle(epoch))
          .catch(() => {});
      }
    });

    this.removeAudio = this.transport.onAudio((frame) => {
      this.avatar.handleAudioFrame();
      void this.output.play(frame).catch(() => {});
    });

    this.removeClose = this.transport.onClose(() => {
      if (this.closed) return;
      this.closed = true;
      this.listening = false;
      this.setState("closed");
      this.detachTransportHandlers();
      this.avatar.handleClosed();
      void this.input.stop().catch(() => {});
      void this.output.stop().catch(() => {});
    });
  }

  getSessionId(): string { return this.sessionId; }
  getDeviceId(): string | undefined { return this.deviceId; }

  async connect(): Promise<void> {
    if (this.closed) throw new Error("RealtimeSession is closed");
    this.setState("connecting");
    await this.transport.waitUntilReady();
    if (this.closed) throw new Error("RealtimeSession is closed");

    await this.transport.send({
      type: "hello",
      version: 1,
      sessionId: this.sessionId,
      deviceId: this.deviceId,
      capabilities: this.capabilities,
    });

    if (this.closed) throw new Error("RealtimeSession is closed");
    this.setState("connected");
  }

  async startListening(): Promise<void> {
    if (this.closed) throw new Error("RealtimeSession is closed");
    if (this.listening) return;

    await this.input.start((frame: AudioFrame) => void this.transport.sendAudio(frame));
    if (this.closed) {
      await this.input.stop();
      return;
    }

    await this.transport.send({ type: "listen", mode: "start" });
    if (this.closed) {
      await this.input.stop();
      return;
    }

    this.listening = true;
  }

  async stopListening(): Promise<void> {
    if (this.closed || !this.listening) return;

    this.listening = false;
    await this.transport.send({ type: "listen", mode: "stop" });
    await this.input.stop();
  }

  async abort(): Promise<void> {
    if (this.closed) return;

    this.listening = false;
    await this.input.stop();
    await this.output.stop();
    this.avatar.handleClosed();

    if (this.closed) return;
    await this.transport.send({ type: "abort", reason: "user_cancel" });
  }

  async close(): Promise<void> {
    if (this.closePromise) {
      await this.closePromise;
      return;
    }

    this.closed = true;
    this.listening = false;
    this.setState("closed");
    this.detachTransportHandlers();

    this.closePromise = (async () => {
      await this.input.stop();
      await this.output.stop();
      await this.transport.close(1000, "client closed");
    })();

    await this.closePromise;
  }

  private detachTransportHandlers(): void {
    this.removeMessage?.();
    this.removeAudio?.();
    this.removeClose?.();
    this.removeMessage = undefined;
    this.removeAudio = undefined;
    this.removeClose = undefined;
  }

  private setState(state: RealtimeSessionState): void {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange?.(state);
  }
}
