import { describe, expect, it } from "vitest";
import type { AsrProvider, TtsProvider } from "../../../runtimes/realtime-device/src/audio-pipeline";
import type { ModelProvider } from "../../brain/src/model-router";
import { BrainLlmProvider } from "./brain-llm";
import { createRealVoicePipeline } from "./real-voice-assembly";
import { OpenAiAsrProvider } from "./providers/openai-asr";
import { OpenAiTtsProvider } from "./providers/openai-tts";

describe("createRealVoicePipeline", () => {
  it("selects real ASR, trusted Brain and real TTS from the explicit real configuration", () => {
    const pipeline = createRealVoicePipeline({ apiKey: "test-key", asrModel: "asr",
      brainModel: "model", ttsModel: "tts", ttsVoice: "alloy", companionId: "luoyao",
      databaseUrl: "postgresql://unused" }, { async query() { throw new Error("No database query during assembly"); } });
    expect(pipeline.asr).toBeInstanceOf(OpenAiAsrProvider);
    expect(pipeline.llm).toBeInstanceOf(BrainLlmProvider);
    expect(pipeline.tts).toBeInstanceOf(OpenAiTtsProvider);
  });
  it("accepts provider-boundary substitutions without replacing Brain orchestration", () => {
    const config = { apiKey: "test-key", asrModel: "asr", brainModel: "model", ttsModel: "tts",
      ttsVoice: "alloy", companionId: "luoyao", databaseUrl: "postgresql://unused" };
    const asr = { async *transcribe() {} } as AsrProvider;
    const tts = { async *synthesize() {} } as TtsProvider;
    const model = { id: "fake", supports: ["fast_chat"], async generate() { return { text: "你好", providerId: "fake" }; } } as ModelProvider;
    const pipeline = createRealVoicePipeline(config, { async query() { return { rows: [] }; } }, { asr, tts, model });
    expect(pipeline.asr).toBe(asr);
    expect(pipeline.llm).toBeInstanceOf(BrainLlmProvider);
    expect(pipeline.tts).toBe(tts);
  });
});
