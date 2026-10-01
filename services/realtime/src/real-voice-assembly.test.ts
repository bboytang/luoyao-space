import { describe, expect, it } from "vitest";
import type { AsrProvider, TtsProvider } from "../../../runtimes/realtime-device/src/audio-pipeline";
import type { ModelProvider } from "../../brain/src/model-router";
import { BrainLlmProvider } from "./brain-llm";
import { createRealVoicePipeline } from "./real-voice-assembly";
import { OpenAiAsrProvider } from "./providers/openai-asr";
import { OpenAiTtsProvider } from "./providers/openai-tts";

const openAiConfig = {
  asr: { provider: "openai", options: { apiKey: "asr-key", model: "asr" } },
  model: { provider: "openai", options: { apiKey: "brain-key", model: "model" } },
  tts: { provider: "openai", options: { apiKey: "tts-key", model: "tts", voice: "alloy" } },
  companionId: "luoyao", databaseUrl: "postgresql://unused",
};

describe("createRealVoicePipeline", () => {
  it("selects real ASR, trusted Brain and real TTS from the explicit real configuration", () => {
    const pipeline = createRealVoicePipeline(openAiConfig,
      { async query() { throw new Error("No database query during assembly"); } });
    expect(pipeline.asr).toBeInstanceOf(OpenAiAsrProvider);
    expect(pipeline.llm).toBeInstanceOf(BrainLlmProvider);
    expect(pipeline.tts).toBeInstanceOf(OpenAiTtsProvider);
  });
  it("selects ASR, Brain model and TTS independently without replacing Brain orchestration", () => {
    const config = { asr: { provider: "fake_asr" }, model: { provider: "fake_model" },
      tts: { provider: "fake_tts" }, companionId: "luoyao", databaseUrl: "postgresql://unused" };
    const asr = { async *transcribe() {} } as AsrProvider;
    const tts = { async *synthesize() {} } as TtsProvider;
    const model = { id: "fake_model", supports: ["fast_chat"], async generate() { return { text: "你好", providerId: "fake_model" }; } } as ModelProvider;
    const pipeline = createRealVoicePipeline(config, { async query() { return { rows: [] }; } }, {
      asr: { fake_asr: () => asr }, model: { fake_model: () => model }, tts: { fake_tts: () => tts },
    });
    expect(pipeline.asr).toBe(asr);
    expect(pipeline.llm).toBeInstanceOf(BrainLlmProvider);
    expect(pipeline.tts).toBe(tts);
  });

  it("does not fall back to another model provider when the selected one is unavailable", () => {
    const alternate = { id: "alternate", supports: ["fast_chat"],
      async generate() { return { text: "never", providerId: "alternate" }; } } as ModelProvider;
    expect(() => createRealVoicePipeline({ ...openAiConfig, model: { provider: "missing" } },
      { async query() { return { rows: [] }; } }, { model: { alternate: () => alternate } }))
      .toThrow(/unsupported Brain model provider/i);
  });

  it("does not fall back to another ASR or TTS provider when selected names are unavailable", () => {
    const asr = { async *transcribe() {} } as AsrProvider;
    const tts = { async *synthesize() {} } as TtsProvider;
    const database = { async query() { return { rows: [] }; } };
    expect(() => createRealVoicePipeline({ ...openAiConfig, asr: { provider: "missing" } }, database,
      { asr: { alternate: () => asr } })).toThrow(/unsupported asr provider/i);
    expect(() => createRealVoicePipeline({ ...openAiConfig, tts: { provider: "missing" } }, database,
      { tts: { alternate: () => tts } })).toThrow(/unsupported tts provider/i);
  });
});
