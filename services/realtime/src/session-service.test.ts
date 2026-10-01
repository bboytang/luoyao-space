import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { AudioPipeline } from "../../../runtimes/realtime-device/src/audio-pipeline";
import type {
  AudioFrame,
  RealtimeControlMessage,
  RealtimeServerMessage,
} from "../../../runtimes/realtime-device/src/protocol";
import {
  RealtimeSessionService,
  type RealtimeSessionConnection,
} from "./session-service";
import { createDemoRealtimePipeline } from "./demo-pipeline";

const wireFixture = JSON.parse(readFileSync(new URL("../../../packages/protocol/src/m2-wire-fixtures.json", import.meta.url), "utf8"));

const frame: AudioFrame = {
  kind: "audio",
  codec: "pcm_s16le",
  sampleRate: 24_000,
  channels: 1,
  sequence: 0,
  payload: new Uint8Array([0, 1, 2, 3]),
};

class FakeConnection implements RealtimeSessionConnection {
  readonly messages: RealtimeServerMessage[] = [];
  readonly audio: AudioFrame[] = [];
  private controlHandlers: Array<(message: RealtimeControlMessage) => void | Promise<void>> = [];
  private audioHandlers: Array<(frame: AudioFrame) => void | Promise<void>> = [];
  private closeHandlers: Array<() => void | Promise<void>> = [];

  async send(message: RealtimeServerMessage): Promise<void> {
    this.messages.push(message);
  }

  async sendAudio(value: AudioFrame): Promise<void> {
    this.audio.push(value);
  }

  onControl(handler: (message: RealtimeControlMessage) => void | Promise<void>): () => void {
    this.controlHandlers.push(handler);
    return () => {
      this.controlHandlers = this.controlHandlers.filter((item) => item !== handler);
    };
  }

  onAudio(handler: (value: AudioFrame) => void | Promise<void>): () => void {
    this.audioHandlers.push(handler);
    return () => {
      this.audioHandlers = this.audioHandlers.filter((item) => item !== handler);
    };
  }

  onClose(handler: () => void | Promise<void>): () => void {
    this.closeHandlers.push(handler);
    return () => {
      this.closeHandlers = this.closeHandlers.filter((item) => item !== handler);
    };
  }

  async control(message: RealtimeControlMessage): Promise<void> {
    for (const handler of [...this.controlHandlers]) await handler(message);
  }

  async pushAudio(value: AudioFrame): Promise<void> {
    for (const handler of [...this.audioHandlers]) await handler(value);
  }

  async close(): Promise<void> {
    for (const handler of [...this.closeHandlers]) await handler();
  }
}

const pipeline: AudioPipeline = {
  vad: {
    detect: async () => ({
      speech: true,
      startOfSpeech: true,
      endOfSpeech: true,
    }),
  },
  asr: {
    async *transcribe(frames) {
      for await (const _frame of frames) {
        yield { type: "partial", text: "hello" as const };
        yield { type: "final", text: "hello" as const };
        return;
      }
    },
  },
  llm: {
    async *stream() {
      yield { type: "sentence", text: "Hi there" as const };
    },
  },
  tts: {
    async *synthesize() {
      yield { type: "audio", frame };
      yield { type: "completed" as const };
    },
  },
};

describe("RealtimeSessionService", () => {
  it("emits fixture STT and TTS controls from an accepted v2 voice turn", async () => {
    const connection = new FakeConnection();
    new RealtimeSessionService(connection, createDemoRealtimePipeline(), {
      admittedSessionId: "transport-1", createMessageId: () => "message-1",
      trustedIdentity: { userId: "user-1", authorizedDeviceId: "ios-device-1" },
    });
    await connection.control(wireFixture.clientControls[0]);
    await connection.pushAudio(frame);
    await connection.control(wireFixture.clientControls[2]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(connection.messages.filter((message) => message.type === "stt" || message.type === "tts"))
      .toEqual(wireFixture.serverControls.slice(0, 4));
    expect(connection.audio).toHaveLength(1);
  });
  it("bridges control, audio, ASR and TTS through the provider-neutral protocol", async () => {
    const connection = new FakeConnection();
    new RealtimeSessionService(connection, pipeline, {
      now: () => "2026-01-01T00:00:00.000Z",
      createMessageId: () => "message-1",
    });

    await connection.control({
      type: "hello",
      version: 1,
      sessionId: "session-1",
    });
    expect(connection.messages[0]).toEqual({
      type: "ready",
      sessionId: "session-1",
      state: "ready",
      serverTime: "2026-01-01T00:00:00.000Z",
    });

    await connection.control({
      type: "listen",
      mode: "start",
      conversationId: "conversation-1",
    });
    await connection.pushAudio(frame);
    await connection.control({ type: "listen", mode: "stop" });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(connection.messages.filter((message) => message.type === "stt")).toEqual([
      { type: "stt", text: "hello", final: false },
      { type: "stt", text: "hello", final: true },
    ]);
    expect(connection.messages.filter((message) => message.type === "tts")).toEqual([
      { type: "tts", state: "start", messageId: "message-1" },
      { type: "tts", state: "stop", messageId: "message-1" },
    ]);
    expect(connection.audio).toEqual([frame]);
  });


  it("aborts an active pipeline without leaving the input queue open", async () => {
    let stopped = false;
    const blockingPipeline: AudioPipeline = {
      ...pipeline,
      asr: {
        async *transcribe(frames, context) {
          for await (const _frame of frames) {
            while (!context.signal.aborted) await new Promise((resolve) => setTimeout(resolve, 1));
            stopped = true;
            return;
          }
        },
      },
      llm: { async *stream() {} },
      tts: { async *synthesize() {} },
    };

    const connection = new FakeConnection();
    new RealtimeSessionService(connection, blockingPipeline);

    await connection.control({
      type: "hello",
      version: 1,
      sessionId: "session-2",
    });
    await connection.control({ type: "listen", mode: "start" });
    await connection.pushAudio(frame);
    await connection.control({ type: "abort", reason: "user_cancel" });

    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    expect(stopped).toBe(true);
  });

  it("keeps the input queue alive and restarts the pipeline for barge-in", async () => {
    let runs = 0;
    let firstRunStopped = false;
    const bargeInPipeline: AudioPipeline = {
      ...pipeline,
      asr: {
        async *transcribe(frames, context) {
          runs += 1;
          for await (const _frame of frames) {
            if (runs === 1) {
              while (!context.signal.aborted) await new Promise((resolve) => setTimeout(resolve, 1));
              firstRunStopped = true;
              return;
            }
            yield { type: "final", text: "interrupted turn" as const };
            return;
          }
        },
      },
    };

    const connection = new FakeConnection();
    new RealtimeSessionService(connection, bargeInPipeline);

    await connection.control({ type: "hello", version: 1, sessionId: "session-barge-in" });
    await connection.control({ type: "listen", mode: "start" });
    await connection.pushAudio(frame);

    const bargeIn = connection.control({ type: "abort", reason: "barge_in" });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await connection.pushAudio({ ...frame, sequence: 1 });
    await bargeIn;

    expect(firstRunStopped).toBe(true);

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    await connection.control({ type: "listen", mode: "stop" });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(runs).toBe(2);
    expect(connection.messages).not.toContainEqual({
      type: "error",
      code: "already_listening",
      message: "A listen session is already active",
      retryable: false,
    });
    expect(connection.messages).toContainEqual({
      type: "stt",
      text: "interrupted turn",
      final: true,
    });
  });

  it("routes frames arriving after barge-in handoff to the new pipeline", async () => {
    const consumedSequences: number[] = [];
    let releaseFirst!: () => void;
    let resolveFirstReady!: () => void;
    const firstReady = new Promise<void>((resolve) => {
      resolveFirstReady = resolve;
    });

    const handoffPipeline: AudioPipeline = {
      ...pipeline,
      asr: {
        async *transcribe(frames, context) {
          for await (const current of frames) {
            consumedSequences.push(current.sequence);
            if (current.sequence === 0) {
              resolveFirstReady();
              await new Promise<void>((resolve) => {
                releaseFirst = resolve;
              });
              return;
            }
            yield { type: "final", text: "new generation" as const };
            return;
          }
        },
      },
    };

    const connection = new FakeConnection();
    new RealtimeSessionService(connection, handoffPipeline);

    await connection.control({ type: "hello", version: 1, sessionId: "session-generation" });
    await connection.control({ type: "listen", mode: "start" });
    await connection.pushAudio(frame);
    await firstReady;

    const bargeIn = connection.control({ type: "abort", reason: "barge_in" });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await connection.pushAudio({ ...frame, sequence: 1 });
    expect(connection.messages).not.toContainEqual({
      type: "barge_in",
      state: "ready",
    });

    releaseFirst();
    await bargeIn;

    expect(connection.messages).toContainEqual({
      type: "barge_in",
      state: "ready",
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    expect(consumedSequences).toEqual([0, 1]);
  });

  it("waits for an aborted pipeline before accepting a new listen session", async () => {
    let runs = 0;
    let firstRunStopped = false;
    const restartablePipeline: AudioPipeline = {
      ...pipeline,
      asr: {
        async *transcribe(frames, context) {
          runs += 1;
          for await (const _frame of frames) {
            if (runs === 1) {
              while (!context.signal.aborted) await new Promise((resolve) => setTimeout(resolve, 1));
              firstRunStopped = true;
              return;
            }
            yield { type: "final", text: "hello again" as const };
            return;
          }
        },
      },
    };

    const connection = new FakeConnection();
    new RealtimeSessionService(connection, restartablePipeline, {
      createMessageId: () => "message-2",
    });

    await connection.control({ type: "hello", version: 1, sessionId: "session-3" });
    await connection.control({ type: "listen", mode: "start" });
    await connection.pushAudio(frame);
    await connection.control({ type: "abort", reason: "user_cancel" });

    expect(firstRunStopped).toBe(true);

    await connection.control({ type: "listen", mode: "start" });
    await connection.pushAudio(frame);
    await connection.control({ type: "listen", mode: "stop" });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(runs).toBe(2);
    expect(connection.messages).not.toContainEqual({
      type: "error",
      code: "already_listening",
      message: "A listen session is already active",
      retryable: false,
    });
    expect(connection.messages).toContainEqual({ type: "stt", text: "hello again", final: true });
  });
});
