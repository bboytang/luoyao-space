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

    const first = await iterator.next();
    outputs.push(first.value?.type ?? "none");

    const second = await iterator.next();
    outputs.push(second.value?.type ?? "none");

    expect(outputs).toEqual(["stt", "aborted"]);
  });
});
