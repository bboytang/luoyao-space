import type { RealtimeAudioInput, RealtimeAudioOutput } from "./audio-io";
import type { AudioFrame, RealtimeServerMessage } from "./protocol";
import type { RealtimeTransport } from "./transport";
import { DEFAULT_REALTIME_CAPABILITIES, type RealtimeCapability } from "./capabilities";

export type RealtimeClientSessionState = "connecting" | "connected" | "closed";

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
  onStateChange?: (state: RealtimeClientSessionState) => void;
}

export class RealtimeSession {
  private readonly transport: RealtimeTransport;
  private readonly input: RealtimeAudioInput;
  private readonly output: RealtimeAudioOutput;
  private readonly avatar: RealtimeAvatarControllerPort;
  private readonly deviceId?: string;
  private readonly capabilities: RealtimeCapability[];
  private readonly onStateChange?: (state: RealtimeClientSessionState) => void;
  private readonly sessionId: string;
  private removeMessage?: () => void;
  private removeAudio?: () => void;
  private removeClose?: () => void;
  private listening = false;
  private closed = false;
  private closePromise?: Promise<void>;
  private abortPromise?: Promise<void>;
  private connectPromise?: Promise<void>;
  private startListeningPromise?: Promise<void>;
  private stopListeningPromise?: Promise<void>;
  private inputStopPromise?: Promise<void>;
  private inputStopCompleted = false;
  private state: RealtimeClientSessionState = "closed";

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
      void this.stopInput().catch(() => {});
      void this.output.stop().catch(() => {});
    });
  }

  getSessionId(): string { return this.sessionId; }
  getDeviceId(): string | undefined { return this.deviceId; }

  async connect(): Promise<void> {
    if (this.closed) throw new Error("RealtimeSession is closed");
    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }
    if (this.state === "connected") return;

    this.connectPromise = (async () => {
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
    })();

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = undefined;
    }
  }

  async startListening(): Promise<void> {
    if (this.closed) throw new Error("RealtimeSession is closed");
    if (this.listening) return;
    if (this.startListeningPromise) {
      await this.startListeningPromise;
      return;
    }

    this.startListeningPromise = (async () => {
      this.inputStopCompleted = false;
      await this.input.start((frame: AudioFrame) => void this.transport.sendAudio(frame));
      if (this.closed) {
        await this.stopInput();
        return;
      }

      await this.transport.send({ type: "listen", mode: "start" });
      if (this.closed) {
        await this.stopInput();
        return;
      }

      this.listening = true;
    })();

    try {
      await this.startListeningPromise;
    } finally {
      this.startListeningPromise = undefined;
    }
  }

  async stopListening(): Promise<void> {
    if (this.closed) return;
    if (this.stopListeningPromise) {
      await this.stopListeningPromise;
      return;
    }
    if (this.startListeningPromise) {
      await this.startListeningPromise;
    }
    if (this.closed || !this.listening) return;

    this.stopListeningPromise = (async () => {
      this.listening = false;
      await this.transport.send({ type: "listen", mode: "stop" });
      await this.stopInput();
    })();

    try {
      await this.stopListeningPromise;
    } finally {
      this.stopListeningPromise = undefined;
    }
  }

  async abort(): Promise<void> {
    if (this.closed) return;
    if (this.abortPromise) {
      await this.abortPromise;
      return;
    }

    this.abortPromise = (async () => {
      await this.startListeningPromise?.catch(() => {});
      await this.stopListeningPromise?.catch(() => {});

      if (this.closed) return;

      this.listening = false;
      await this.stopInput();
      await this.output.stop();
      this.avatar.handleClosed();

      if (this.closed) return;
      await this.transport.send({ type: "abort", reason: "user_cancel" });
    })();

    try {
      await this.abortPromise;
    } finally {
      this.abortPromise = undefined;
    }
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
      let cleanupError: unknown;

      try {
        await this.transport.close(1000, "client closed");
      } catch (error) {
        cleanupError = error;
      }

      const lifecycleOperations = [
        this.connectPromise,
        this.startListeningPromise,
        this.stopListeningPromise,
      ].filter((promise): promise is Promise<void> => promise !== undefined);

      await Promise.allSettled(lifecycleOperations);

      try {
        await this.stopInput();
      } catch (error) {
        cleanupError ??= error;
      }

      try {
        await this.output.stop();
      } catch (error) {
        cleanupError ??= error;
      }

      if (cleanupError !== undefined) throw cleanupError;
    })();

    await this.closePromise;
  }

  private async stopInput(): Promise<void> {
    if (this.inputStopCompleted) return;
    if (this.inputStopPromise) {
      await this.inputStopPromise;
      return;
    }

    this.inputStopPromise = (async () => {
      await this.input.stop();
      this.inputStopCompleted = true;
    })();

    try {
      await this.inputStopPromise;
    } finally {
      this.inputStopPromise = undefined;
    }
  }

  private detachTransportHandlers(): void {
    this.removeMessage?.();
    this.removeAudio?.();
    this.removeClose?.();
    this.removeMessage = undefined;
    this.removeAudio = undefined;
    this.removeClose = undefined;
  }

  private setState(state: RealtimeClientSessionState): void {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange?.(state);
  }
}
