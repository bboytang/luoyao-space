import { describe, expect, it } from "vitest";
import { loadRealtimeConfig } from "./config";

describe("loadRealtimeConfig", () => {
  it("loads safe defaults", () => {
    expect(loadRealtimeConfig({})).toEqual({
      host: "127.0.0.1",
      port: 8787,
      providers: { vad: "demo", asr: "demo", llm: "demo", tts: "demo" },
    });
  });

  it("loads provider selections without exposing secrets", () => {
    expect(
      loadRealtimeConfig({
        REALTIME_HOST: "0.0.0.0",
        REALTIME_PORT: "9000",
        REALTIME_VAD_PROVIDER: "demo",
        REALTIME_ASR_PROVIDER: "cloud_asr",
        REALTIME_LLM_PROVIDER: "cloud_llm",
        REALTIME_TTS_PROVIDER: "cloud_tts",
        CLOUD_LLM_API_KEY: "should-not-be-read",
      }),
    ).toEqual({
      host: "0.0.0.0",
      port: 9000,
      providers: { vad: "demo", asr: "cloud_asr", llm: "cloud_llm", tts: "cloud_tts" },
    });
  });

  it("rejects invalid ports", () => {
    expect(() => loadRealtimeConfig({ REALTIME_PORT: "0" })).toThrow();
    expect(() => loadRealtimeConfig({ REALTIME_PORT: "abc" })).toThrow();
  });

  it("rejects invalid provider names", () => {
    expect(() => loadRealtimeConfig({ REALTIME_LLM_PROVIDER: "bad provider" })).toThrow();
  });
});
