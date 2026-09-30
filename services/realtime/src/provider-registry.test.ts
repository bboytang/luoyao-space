import { describe, expect, it } from "vitest";
import type { AudioPipeline } from "../../../runtimes/realtime-device/src/audio-pipeline";
import { createDemoRealtimePipeline } from "./demo-pipeline";
import {
  createRealtimePipeline,
  type RealtimeProviderConfig,
  type RealtimeProviderFactories,
} from "./provider-registry";

describe("createRealtimePipeline", () => {
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
