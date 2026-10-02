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
import type { VoiceTurnDiagnostic } from "./voice-turn-diagnostic";

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
  it("reports sanitized stage facts for a completed voice turn", async () => {
    const connection = new FakeConnection();
    const diagnostics: VoiceTurnDiagnostic[] = [];
    new RealtimeSessionService(connection, pipeline, {
      admittedSessionId: "PRIVATE_SESSION",
      trustedIdentity: { userId: "PRIVATE_USER", authorizedDeviceId: "PRIVATE_DEVICE" },
      onTurnDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    await connection.control({ type: "listen", mode: "start" });
    await connection.pushAudio(frame);
    await connection.control({ type: "listen", mode: "stop" });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(diagnostics.at(-1)).toMatchObject({
      stage: "terminal", inputFrames: 1, inputBytes: 4, listenStopReceived: true,
      asrPartialEvents: 1, asrFinalEvents: 1, nonEmptyAsrFinal: true,
      asrProviderCompleted: true, brainStarted: true, brainCompleted: true,
      ttsStarted: true, firstTtsAudioProduced: true, firstTtsAudioSent: true,
      outputFrames: 1, outputBytes: 4, ttsCompleted: true, outcome: "completed",
    });
    expect(diagnostics.map((diagnostic) => diagnostic.stage)).toEqual(expect.arrayContaining([
      "listen_start", "input_received", "listen_stop", "asr_partial", "asr_final",
      "asr_completed", "brain_started", "brain_completed", "tts_started",
      "tts_first_audio_produced", "tts_first_audio_sent", "tts_completed", "terminal",
    ]));
    expect(JSON.stringify(diagnostics)).not.toMatch(/PRIVATE_USER|PRIVATE_DEVICE|PRIVATE_SESSION|"text"|"payload"|"sessionId"|"deviceId"/);
  });

  it("distinguishes partial-only ASR completion from a final that starts Brain", async () => {
    const connection = new FakeConnection();
    const diagnostics: VoiceTurnDiagnostic[] = [];
    const partialOnly: AudioPipeline = {
      ...pipeline,
      asr: { async *transcribe(frames) {
        for await (const _frame of frames) { yield { type: "partial", text: "PRIVATE_TRANSCRIPT" }; }
      } },
      llm: { async *stream() { throw new Error("Brain must not run"); } },
      tts: { async *synthesize() { throw new Error("TTS must not run"); } },
    };
    new RealtimeSessionService(connection, partialOnly, {
      admittedSessionId: "PRIVATE_SESSION",
      onTurnDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    await connection.control({ type: "listen", mode: "start" });
    await connection.pushAudio(frame);
    await connection.control({ type: "listen", mode: "stop" });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(diagnostics.at(-1)).toMatchObject({
      stage: "terminal", asrPartialEvents: 1, asrFinalEvents: 0,
      nonEmptyAsrFinal: false, asrProviderCompleted: true,
      brainStarted: false, brainCompleted: false, ttsStarted: false,
      firstTtsAudioSent: false, outcome: "completed",
    });
    expect(connection.audio).toHaveLength(0);
    expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_TRANSCRIPT");
  });

  it("reports pipeline failure by sanitized stage without provider or identity data", async () => {
    const connection = new FakeConnection();
    const diagnostics: VoiceTurnDiagnostic[] = [];
    const failed: AudioPipeline = {
      ...pipeline,
      asr: { async *transcribe(frames) {
        for await (const _frame of frames) throw new Error("PRIVATE_PROVIDER_ERROR token=PRIVATE_TOKEN");
      } },
    };
    new RealtimeSessionService(connection, failed, {
      admittedSessionId: "PRIVATE_SESSION",
      trustedIdentity: { userId: "PRIVATE_USER", authorizedDeviceId: "PRIVATE_DEVICE" },
      onTurnDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    await connection.control({ type: "listen", mode: "start" });
    await connection.pushAudio(frame);
    await connection.control({ type: "listen", mode: "stop" });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(diagnostics.at(-1)).toMatchObject({ stage: "terminal", outcome: "failed", failureStage: "asr" });
    expect(JSON.stringify(diagnostics)).not.toMatch(/PRIVATE_PROVIDER_ERROR|PRIVATE_TOKEN|PRIVATE_USER|PRIVATE_DEVICE|PRIVATE_SESSION/);
  });

  it("distinguishes produced TTS audio from a failed outbound send", async () => {
    class FailingAudioConnection extends FakeConnection {
      override async sendAudio(): Promise<void> {
        throw new Error("PRIVATE_OUTPUT_ERROR token=PRIVATE_TOKEN");
      }
    }
    const connection = new FailingAudioConnection();
    const diagnostics: VoiceTurnDiagnostic[] = [];
    new RealtimeSessionService(connection, pipeline, {
      admittedSessionId: "PRIVATE_SESSION",
      onTurnDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    await connection.control({ type: "listen", mode: "start" });
    await connection.pushAudio(frame);
    await connection.control({ type: "listen", mode: "stop" });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(diagnostics.at(-1)).toMatchObject({
      stage: "terminal", outcome: "failed", failureStage: "output",
      firstTtsAudioProduced: true, firstTtsAudioSent: false,
      outputFrames: 0, outputBytes: 0,
    });
    expect(JSON.stringify(diagnostics)).not.toMatch(/PRIVATE_OUTPUT_ERROR|PRIVATE_TOKEN|PRIVATE_SESSION/);
  });

  it("keeps voice output working when the diagnostic logger throws", async () => {
    const connection = new FakeConnection();
    let diagnosticCalls = 0;
    new RealtimeSessionService(connection, pipeline, {
      admittedSessionId: "PRIVATE_SESSION",
      onTurnDiagnostic: () => { diagnosticCalls += 1; throw new Error("diagnostic logger unavailable"); },
    });
    await connection.control({ type: "listen", mode: "start" });
    await connection.pushAudio(frame);
    await connection.control({ type: "listen", mode: "stop" });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(connection.audio).toEqual([frame]);
    expect(connection.messages).toContainEqual({ type: "stt", text: "hello", final: true });
    expect(connection.messages).not.toContainEqual(expect.objectContaining({ type: "error" }));
    expect(diagnosticCalls).toBeGreaterThan(0);
  });

  it("sends a deterministic error when a provider fails during an admitted turn", async () => {
    const connection = new FakeConnection();
    const failed: AudioPipeline = {
      ...pipeline,
      asr: { async *transcribe(frames) {
        for await (const _frame of frames) throw new Error("Bearer secret-key https://provider.test/?token=secret-key private transcript");
      } },
    };
    new RealtimeSessionService(connection, failed, {
      admittedSessionId: "transport-1", trustedIdentity: { userId: "user-1", authorizedDeviceId: "device-1" },
    });
    await connection.control({ type: "listen", mode: "start" });
    await connection.pushAudio(frame);
    await connection.control({ type: "listen", mode: "stop" });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(connection.messages).toContainEqual({ type: "error", code: "pipeline_error", message: "Realtime provider failed", retryable: true });
    expect(JSON.stringify(connection.messages)).not.toMatch(/secret-key|provider\.test|private transcript/);
  });
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
    const diagnostics: VoiceTurnDiagnostic[] = [];
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
    new RealtimeSessionService(connection, blockingPipeline, {
      onTurnDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

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
    expect(diagnostics.at(-1)).toMatchObject({
      stage: "terminal", outcome: "cancelled", listenStopReceived: false,
    });
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
