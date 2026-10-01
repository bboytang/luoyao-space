import { describe, expect, it } from "vitest";
import { loadRealtimeConfig } from "./config";

describe("loadRealtimeConfig", () => {
  it("loads safe defaults", () => {
    expect(loadRealtimeConfig({})).toEqual({
      host: "127.0.0.1",
      port: 8787,
      providers: { vad: "demo", asr: "demo", llm: "demo", tts: "demo" },
      openai: undefined,
      development: { enabled: false, legacyV1: false, identity: undefined },
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
      openai: undefined,
      development: { enabled: false, legacyV1: false, identity: undefined },
    });
  });

  it("loads OpenAI credentials only when supplied", () => {
    expect(
      loadRealtimeConfig({
        REALTIME_LLM_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key",
        OPENAI_MODEL: "test-model",
        OPENAI_BASE_URL: "https://example.test/v1",
      }),
    ).toEqual({
      host: "127.0.0.1",
      port: 8787,
      providers: { vad: "demo", asr: "demo", llm: "openai", tts: "demo" },
      openai: {
        apiKey: "test-key",
        model: "test-model",
        baseUrl: "https://example.test/v1",
      },
      development: { enabled: false, legacyV1: false, identity: undefined },
    });
  });

  it("requires OpenAI credentials when selected", () => {
    expect(() =>
      loadRealtimeConfig({
        REALTIME_LLM_PROVIDER: "openai",
      }),
    ).toThrow("OPENAI_API_KEY and OPENAI_MODEL are required");
  });

  it("rejects invalid ports", () => {
    expect(() => loadRealtimeConfig({ REALTIME_PORT: "0" })).toThrow();
    expect(() => loadRealtimeConfig({ REALTIME_PORT: "abc" })).toThrow();
  });

  it("rejects invalid provider names", () => {
    expect(() => loadRealtimeConfig({ REALTIME_LLM_PROVIDER: "bad provider" })).toThrow();
  });

  it("requires explicit, local, non-production development mode for v1 compatibility", () => {
    expect(() => loadRealtimeConfig({ REALTIME_DEV_V1_COMPAT: "1" })).toThrow(/development mode/i);
    expect(() => loadRealtimeConfig({ REALTIME_DEV_MODE: "1", REALTIME_HOST: "0.0.0.0" })).toThrow(/loopback/i);
    expect(() => loadRealtimeConfig({ REALTIME_DEV_MODE: "1", NODE_ENV: "production" })).toThrow(/production/i);
    expect(loadRealtimeConfig({ REALTIME_DEV_MODE: "1", REALTIME_DEV_V1_COMPAT: "1" }).development).toEqual({
      enabled: true, legacyV1: true, identity: undefined,
    });
  });

  it("creates a development identity only from explicit configured user and device IDs", () => {
    expect(() => loadRealtimeConfig({ REALTIME_DEV_MODE: "1", REALTIME_DEV_USER_ID: "user-1" })).toThrow(/both/i);
    expect(loadRealtimeConfig({
      REALTIME_DEV_MODE: "1", REALTIME_DEV_USER_ID: "user-1", REALTIME_DEV_DEVICE_ID: "device-1",
    }).development).toEqual({
      enabled: true, legacyV1: false, identity: { userId: "user-1", deviceId: "device-1" },
    });
  });
});
