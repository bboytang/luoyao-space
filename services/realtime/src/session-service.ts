import type { AudioPipeline } from "../../../runtimes/realtime-device/src/audio-pipeline";
import type { AudioFrame, RealtimeControlMessage, RealtimeServerMessage } from "../../../runtimes/realtime-device/src/protocol";
import { runAudioPipeline } from "../../../runtimes/realtime-device/src/pipeline-runner";

export interface RealtimeSessionConnection {
  send(message: RealtimeServerMessage): Promise<void>;
  sendAudio(frame: AudioFrame): Promise<void>;
  onControl(handler: (message: RealtimeControlMessage) => void | Promise<void>): () => void;
  onAudio(handler: (frame: AudioFrame) => void | Promise<void>): () => void;
  onClose(handler: () => void | Promise<void>): () => void;
}

export interface RealtimeSessionServiceOptions {
  now?: () => string;
  createMessageId?: () => string;
}

class AudioFrameQueue implements AsyncIterable<AudioFrame> {
  private readonly frames: AudioFrame[] = [];
  private readonly waiters: Array<(result: IteratorResult<AudioFrame>) => void> = [];
  private ended = false;

  push(frame: AudioFrame): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: frame, done: false });
    else this.frames.push(frame);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    while (this.waiters.length) this.waiters.shift()?.({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<AudioFrame> {
    return this;
  }

  next(): Promise<IteratorResult<AudioFrame>> {
    const frame = this.frames.shift();
    if (frame) return Promise.resolve({ value: frame, done: false });
    if (this.ended) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

export class RealtimeSessionService {
  private readonly now: () => string;
  private readonly createMessageId: () => string;
  private readonly unsubscribeControl: () => void;
  private readonly unsubscribeAudio: () => void;
  private readonly unsubscribeClose: () => void;

  private sessionId?: string;
  private conversationId?: string;
  private queue?: AudioFrameQueue;
  private controller?: AbortController;
  private pipelinePromise?: Promise<void>;
  private ttsMessageId?: string;
  private bargeInQueueHandoff?: AudioFrameQueue;
  private closed = false;

  constructor(
    private readonly connection: RealtimeSessionConnection,
    private readonly pipeline: AudioPipeline,
    options: RealtimeSessionServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createMessageId = options.createMessageId ?? (() => crypto.randomUUID());
    this.unsubscribeControl = connection.onControl((message) => this.handleControl(message));
    this.unsubscribeAudio = connection.onAudio((frame) => this.handleAudio(frame));
    this.unsubscribeClose = connection.onClose(() => this.dispose());
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.controller?.abort();
    this.queue?.end();
    this.unsubscribeControl();
    this.unsubscribeAudio();
    this.unsubscribeClose();
  }

  private async handleControl(message: RealtimeControlMessage): Promise<void> {
    if (this.closed) return;

    try {
      switch (message.type) {
        case "hello":
          await this.handleHello(message.sessionId);
          break;
        case "listen":
          await this.handleListen(message.mode, message.conversationId);
          break;
        case "abort":
          if (message.reason === "barge_in") {
            await this.handleBargeIn();
          } else {
            await this.handleAbort();
          }
          break;
        case "ping":
          await this.connection.send({ type: "pong", timestamp: message.timestamp });
          break;
      }
    } catch (error) {
      await this.sendError("session_error", error instanceof Error ? error.message : String(error), true);
    }
  }

  private async handleHello(sessionId: string): Promise<void> {
    if (this.sessionId) {
      await this.sendError("already_initialized", "Session is already initialized", false);
      return;
    }

    this.sessionId = sessionId;
    this.conversationId = sessionId;
    await this.connection.send({
      type: "ready",
      sessionId,
      state: "ready",
      serverTime: this.now(),
    });
  }

  private async handleListen(
    mode: "start" | "stop",
    conversationId?: string,
  ): Promise<void> {
    if (!this.sessionId) {
      await this.sendError("not_initialized", "Send hello before listen", false);
      return;
    }

    if (mode === "start") {
      if (this.queue) {
        await this.sendError("already_listening", "A listen session is already active", false);
        return;
      }

      this.conversationId = conversationId ?? this.sessionId;
      this.queue = new AudioFrameQueue();
      this.controller = new AbortController();
      this.ttsMessageId = undefined;

      const pipelinePromise = this.runPipeline(this.queue, this.controller);
      this.pipelinePromise = pipelinePromise;
      void pipelinePromise.finally(() => {
        if (this.pipelinePromise === pipelinePromise) this.pipelinePromise = undefined;
      });
      return;
    }

    this.queue?.end();
  }

  private handleAudio(frame: AudioFrame): void {
    if (this.closed || !this.sessionId) return;
    this.queue?.push(frame);
  }

  private async handleAbort(): Promise<void> {
    this.controller?.abort();
    this.queue?.end();
    await this.pipelinePromise;
  }

  private async handleBargeIn(): Promise<void> {
    const queue = this.queue;
    const controller = this.controller;
    const pipelinePromise = this.pipelinePromise;
    if (!queue || !controller || !pipelinePromise) return;

    this.bargeInQueueHandoff = queue;
    controller.abort();
    await pipelinePromise;

    if (this.closed || this.queue !== queue) {
      this.bargeInQueueHandoff = undefined;
      return;
    }

    this.bargeInQueueHandoff = undefined;
    const nextController = new AbortController();
    this.controller = nextController;
    const nextPipelinePromise = this.runPipeline(queue, nextController);
    this.pipelinePromise = nextPipelinePromise;
    void nextPipelinePromise.finally(() => {
      if (this.pipelinePromise === nextPipelinePromise) this.pipelinePromise = undefined;
    });
  }

  private async runPipeline(
    queue: AudioFrameQueue,
    controller: AbortController,
    preserveQueueOnFinish = false,
  ): Promise<void> {
    const sessionId = this.sessionId;
    const conversationId = this.conversationId;
    if (!sessionId || !conversationId) return;

    try {
      for await (const output of runAudioPipeline(this.pipeline, queue, {
        sessionId,
        conversationId,
        signal: controller.signal,
      })) {
        if (output.type === "stt") {
          await this.connection.send({
            type: "stt",
            text: output.text ?? "",
            final: output.final ?? false,
          });
          continue;
        }

        if (output.type === "tts_audio" && output.frame) {
          if (!this.ttsMessageId) {
            this.ttsMessageId = this.createMessageId();
            await this.connection.send({
              type: "tts",
              state: "start",
              messageId: this.ttsMessageId,
            });
          }
          await this.connection.sendAudio(output.frame);
          continue;
        }

        if (
          output.type === "completed" ||
          output.type === "aborted" ||
          output.type === "error"
        ) {
          await this.finishTts();
        }
      }
    } catch (error) {
      await this.finishTts();
      await this.sendError(
        "pipeline_error",
        error instanceof Error ? error.message : String(error),
        true,
      );
    } finally {
      const preserveQueue =
        preserveQueueOnFinish || this.bargeInQueueHandoff === queue;
      if (!preserveQueue && this.queue === queue) this.queue = undefined;
      if (this.controller === controller) this.controller = undefined;
      this.ttsMessageId = undefined;
    }
  }

  private async finishTts(): Promise<void> {
    if (!this.ttsMessageId) return;
    const messageId = this.ttsMessageId;
    this.ttsMessageId = undefined;
    await this.connection.send({
      type: "tts",
      state: "stop",
      messageId,
    });
  }

  private async sendError(code: string, message: string, retryable: boolean): Promise<void> {
    await this.connection.send({ type: "error", code, message, retryable });
  }
}
