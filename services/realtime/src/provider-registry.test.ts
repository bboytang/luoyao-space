import { describe, expect, it } from "vitest";
import type { AudioPipeline } from "../../../runtimes/realtime-device/src/audio-pipeline";
import { runAudioPipeline } from "../../../runtimes/realtime-device/src/pipeline-runner";
import { createDemoRealtimePipeline } from "./demo-pipeline";
import {
  createDefaultRealtimeProviderFactories,
  createRealtimePipeline,
  type RealtimeProviderConfig,
  type RealtimeProviderFactories,
} from "./provider-registry";

describe("createRealtimePipeline", () => {
  it("runs the default demo path without external provider credentials", async () => {
    const selected: RealtimeProviderConfig = {
      vad: { provider: "demo" }, asr: { provider: "demo" },
      llm: { provider: "demo" }, tts: { provider: "demo" },
    };
    const pipeline = createRealtimePipeline(selected, createDefaultRealtimeProviderFactories());
    const input = (async function* () {
      yield { kind: "audio" as const, codec: "pcm_s16le" as const, sampleRate: 24_000,
        channels: 1, sequence: 0, payload: new Uint8Array([1, 0]) };
    })();
    const outputs = [];
    for await (const output of runAudioPipeline(pipeline, input, {
      sessionId: "demo-session", conversationId: "demo-conversation", signal: new AbortController().signal,
    })) outputs.push(output);
    expect(outputs).toContainEqual({ type: "stt", text: "你好", final: true });
    expect(outputs.some((output) => output.type === "tts_audio")).toBe(true);
    expect(outputs.at(-1)).toEqual({ type: "completed" });
  });
  it("offers real ASR and TTS only with explicit credentials and keeps Brain injection required", () => {
    const factories = createDefaultRealtimeProviderFactories();
    expect(() => factories.asr.openai?.({ model: "asr" })).toThrow(/apiKey/i);
    expect(() => factories.tts.openai?.({ model: "tts", voice: "alloy" })).toThrow(/apiKey/i);
    expect(factories.asr.openai?.({ apiKey: "key", model: "asr" })).toBeDefined();
    expect(factories.tts.openai?.({ apiKey: "key", model: "tts", voice: "alloy" })).toBeDefined();
    expect(() => factories.llm.brain?.()).toThrow(/Brain.*not configured/i);
  });
  it("registers OpenAI as the default LLM provider", () => {
    const factories = createDefaultRealtimeProviderFactories();
    const provider = factories.llm.openai?.({
      apiKey: "test-key",
      model: "test-model",
    });

    expect(provider).toBeDefined();
  });

  it("requires credentials when creating OpenAI", () => {
    const factories = createDefaultRealtimeProviderFactories();

    expect(() => factories.llm.openai?.({ model: "test-model" })).toThrow(
      'Provider option "apiKey" is required',
    );
  });
  const factories: RealtimeProviderFactories = {
    vad: { demo: () => ({} as AudioPipeline["vad"]) },
    asr: { demo: () => ({} as AudioPipeline["asr"]) },
    llm: { demo: () => ({} as AudioPipeline["llm"]) },
    tts: { demo: () => ({} as AudioPipeline["tts"]) },
  };

  it("composes independently selected providers without vendor coupling", () => {
    const demo = createDemoRealtimePipeline();
    const demoFactories: RealtimeProviderFactories = {
      vad: { demo: () => demo.vad },
      asr: { demo: () => demo.asr },
      llm: { demo: () => demo.llm },
      tts: { demo: () => demo.tts },
    };
    const config: RealtimeProviderConfig = {
      vad: { provider: "demo" },
      asr: { provider: "demo" },
      llm: { provider: "demo" },
      tts: { provider: "demo" },
    };

    const pipeline = createRealtimePipeline(config, demoFactories);
    expect(pipeline.vad).toBe(demo.vad);
    expect(pipeline.asr).toBe(demo.asr);
    expect(pipeline.llm).toBe(demo.llm);
    expect(pipeline.tts).toBe(demo.tts);
  });

  it("passes provider options to factories", () => {
    const seen: unknown[] = [];
    const provider = {} as AudioPipeline["asr"];
    const optionFactories: RealtimeProviderFactories = {
      ...factories,
      asr: {
        demo: (options) => {
          seen.push(options);
          return provider;
        },
      },
    };
    const config: RealtimeProviderConfig = {
      vad: { provider: "demo" },
      asr: { provider: "demo", options: { model: "example", language: "zh" } },
      llm: { provider: "demo" },
      tts: { provider: "demo" },
    };

    createRealtimePipeline(config, optionFactories);
    expect(seen).toEqual([{ model: "example", language: "zh" }]);
  });

  it("fails clearly for an unknown provider", () => {
    const missingFactories = {
      vad: {},
      asr: {},
      llm: {},
      tts: {},
    } as RealtimeProviderFactories;

    expect(() =>
      createRealtimePipeline(
        {
          vad: { provider: "missing" },
          asr: { provider: "missing" },
          llm: { provider: "missing" },
          tts: { provider: "missing" },
        },
        missingFactories,
      ),
    ).toThrow("Unsupported vad provider: missing");
  });

  it("rejects empty provider configuration before factory lookup", () => {
    expect(() =>
      createRealtimePipeline(
        {
          vad: { provider: " " },
          asr: { provider: "demo" },
          llm: { provider: "demo" },
          tts: { provider: "demo" },
        },
        factories,
      ),
    ).toThrow("Invalid vad provider configuration");
  });
});
