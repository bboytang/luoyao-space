import { describe, expect, it } from "vitest";
import type { AudioFrame } from "./protocol";
import { runAudioPipeline } from "./pipeline-runner";
import type { AudioPipeline } from "./audio-pipeline";

const frame: AudioFrame = {
  kind: "audio",
  codec: "pcm_s16le",
  sampleRate: 16_000,
  channels: 1,
  sequence: 1,
  payload: new Uint8Array([0, 1]),
};

async function* neverEndingInput(): AsyncIterable<AudioFrame> {
  yield frame;
  await new Promise<void>(() => {});
}

async function* failingInput(): AsyncIterable<AudioFrame> {
  throw new Error("input failed");
}

describe("runAudioPipeline", () => {
  it("surfaces input feeder failures", async () => {
    const pipeline: AudioPipeline = {
      vad: { detect: async () => ({ speech: false, startOfSpeech: false, endOfSpeech: true }) },
      asr: { async *transcribe() { yield { type: "final", text: "" as const }; } },
      llm: { async *stream() {} },
      tts: { async *synthesize() {} },
    };

    const outputs: string[] = [];
    for await (const output of runAudioPipeline(pipeline, failingInput(), {
      sessionId: "session-failure",
      conversationId: "conversation-failure",
      signal: new AbortController().signal,
    })) {
      outputs.push(output.type);
    }

    expect(outputs).toEqual(["stt", "error"]);
  });

  it("reports latency milestones without changing pipeline outputs", async () => {
    const metrics: Array<Readonly<import("./audio-pipeline").PipelineMetrics>> = [];
    const pipeline: AudioPipeline = {
      vad: { detect: async () => ({ speech: true, startOfSpeech: true, endOfSpeech: true }) },
      asr: { async *transcribe() { yield { type: "partial", text: "hello" as const }; yield { type: "final", text: "hello" as const }; } },
      llm: { async *stream() { yield { type: "text_delta", text: "hi" as const }; yield { type: "sentence", text: "hi" as const }; } },
      tts: { async *synthesize() { yield { type: "started" as const }; yield { type: "audio" as const, frame }; yield { type: "completed" as const }; } },
    };
    const outputs: string[] = [];
    for await (const output of runAudioPipeline(pipeline, (async function* () { yield frame; })(), {
      sessionId: "metrics-session", conversationId: "metrics-conversation", signal: new AbortController().signal,
      onMetrics: (value) => metrics.push(value),
    })) outputs.push(output.type);
    expect(outputs).toEqual(["stt", "stt", "tts_audio", "completed"]);
    const pipelineOutputs = [] as Array<{ type: string; final?: boolean }>;
    for await (const output of runAudioPipeline(pipeline, (async function* () { yield frame; })(), {
      sessionId: "metrics-session-2", conversationId: "metrics-conversation-2", signal: new AbortController().signal,
    })) pipelineOutputs.push(output);
    expect(pipelineOutputs.filter((output) => output.type === "stt").map((output) => output.final)).toEqual([false, true]);

    const final = metrics.at(-1);
    expect(final?.asrFirstPartialMs).toBeTypeOf("number");
    expect(final?.asrFinalMs).toBeTypeOf("number");
    expect(final?.llmFirstTokenMs).toBeTypeOf("number");
    expect(final?.firstSentenceMs).toBeTypeOf("number");
    expect(final?.ttsFirstAudioMs).toBeTypeOf("number");
    expect(final?.totalResponseMs).toBeTypeOf("number");
  });

  it("does not wait for a live input stream after abort", async () => {
    const controller = new AbortController();

    const pipeline: AudioPipeline = {
      vad: {
        detect: async () => ({
          speech: true,
          startOfSpeech: true,
          endOfSpeech: false,
        }),
      },
      asr: {
        async *transcribe() {
          yield { type: "partial", text: "hello" as const };
          controller.abort();
          yield { type: "final", text: "hello" as const };
        },
      },
      llm: {
        async *stream() {
          yield { type: "done", finishReason: "abort" as const };
        },
      },
      tts: {
        async *synthesize() {
          yield { type: "completed" as const };
        },
      },
    };

    const outputs: string[] = [];
    const iterator = runAudioPipeline(pipeline, neverEndingInput(), {
      sessionId: "session-1",
      conversationId: "conversation-1",
      signal: controller.signal,
    });

    const asyncIterator = iterator[Symbol.asyncIterator]();
    const first = await asyncIterator.next();
    outputs.push(first.value?.type ?? "none");

    const second = await asyncIterator.next();
    outputs.push(second.value?.type ?? "none");

    expect(outputs).toEqual(["stt", "aborted"]);
  });
});
