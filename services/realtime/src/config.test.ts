import { describe, expect, it } from "vitest";
import { loadRealtimeConfig } from "./config";

describe("loadRealtimeConfig", () => {
  it("loads safe defaults", () => {
    expect(loadRealtimeConfig({})).toEqual({
      host: "127.0.0.1",
      port: 8787,
      providers: { vad: "demo", asr: "demo", llm: "demo", tts: "demo" },
      openai: undefined,
      realVoice: undefined,
      development: { enabled: false, legacyV1: false, identity: undefined },
      physicalDevelopment: undefined,
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
      realVoice: undefined,
      development: { enabled: false, legacyV1: false, identity: undefined },
      physicalDevelopment: undefined,
    });
  });

  it("loads OpenAI credentials only when supplied", () => {
    expect(
      loadRealtimeConfig({
        REALTIME_LLM_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key",
        OPENAI_MODEL: "test-model",
        OPENAI_BASE_URL: "https://example.test/v1",
        REALTIME_DEV_MODE: "1", REALTIME_DEV_V1_COMPAT: "1",
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
      realVoice: undefined,
      development: { enabled: true, legacyV1: true, identity: undefined },
      physicalDevelopment: undefined,
    });
  });

  it("requires OpenAI credentials when selected", () => {
    expect(() =>
      loadRealtimeConfig({
        REALTIME_LLM_PROVIDER: "openai", REALTIME_DEV_MODE: "1", REALTIME_DEV_V1_COMPAT: "1",
      }),
    ).toThrow("OPENAI_API_KEY and OPENAI_MODEL are required");
  });

  it("accepts only an explicit complete real voice provider set and fails closed on partial configuration", () => {
    const real = {
      REALTIME_ASR_PROVIDER: "openai", REALTIME_LLM_PROVIDER: "brain", REALTIME_TTS_PROVIDER: "openai",
      REALTIME_BRAIN_MODEL_PROVIDER: "openai", REALTIME_RELATIONSHIP_MODE: "initial",
      OPENAI_API_KEY: "test-key", OPENAI_ASR_MODEL: "asr-model", OPENAI_MODEL: "brain-model",
      OPENAI_TTS_MODEL: "tts-model", OPENAI_TTS_VOICE: "alloy",
      REALTIME_COMPANION_ID: "luoyao", DATABASE_URL: "postgresql://example.test/luoyao",
    };
    expect(loadRealtimeConfig(real).realVoice).toMatchObject({
      asrModel: "asr-model", brainModel: "brain-model", ttsModel: "tts-model", ttsVoice: "alloy",
      companionId: "luoyao", databaseUrl: "postgresql://example.test/luoyao",
    });
    expect(() => loadRealtimeConfig({ ...real, OPENAI_API_KEY: "" })).toThrow(/OPENAI_API_KEY/);
    expect(() => loadRealtimeConfig({ ...real, REALTIME_TTS_PROVIDER: "demo" })).toThrow(/complete real voice/i);
    expect(() => loadRealtimeConfig({ ...real, REALTIME_BRAIN_MODEL_PROVIDER: "" })).toThrow(/BRAIN_MODEL_PROVIDER/);
    expect(() => loadRealtimeConfig({ REALTIME_LLM_PROVIDER: "openai", OPENAI_API_KEY: "key", OPENAI_MODEL: "m" })).toThrow(/v1 development/i);
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

  it("keeps physical-device authentication off unless fully and explicitly configured", () => {
    const token = "a".repeat(64);
    const fields = { REALTIME_PHYSICAL_DEV_TOKEN: token,
      REALTIME_PHYSICAL_DEV_USER_ID: "trusted-user", REALTIME_PHYSICAL_DEV_DEVICE_ID: "authorized-phone" };
    expect(loadRealtimeConfig({}).physicalDevelopment).toBeUndefined();
    expect(() => loadRealtimeConfig(fields)).toThrow(/physical-device development mode/i);
    expect(() => loadRealtimeConfig({ REALTIME_PHYSICAL_DEV_MODE: "1" })).toThrow(/requires.*token.*user.*device/i);
    expect(loadRealtimeConfig({ REALTIME_PHYSICAL_DEV_MODE: "1", ...fields }).physicalDevelopment).toEqual({
      token, userId: "trusted-user", deviceId: "authorized-phone",
    });
  });

  it("rejects physical-device auth alongside the old bypass, production, or a non-loopback listener", () => {
    const fields = { REALTIME_PHYSICAL_DEV_MODE: "1", REALTIME_PHYSICAL_DEV_TOKEN: "a".repeat(64),
      REALTIME_PHYSICAL_DEV_USER_ID: "trusted-user", REALTIME_PHYSICAL_DEV_DEVICE_ID: "authorized-phone" };
    expect(() => loadRealtimeConfig({ ...fields, REALTIME_DEV_MODE: "1" })).toThrow(/mutually exclusive/i);
    expect(() => loadRealtimeConfig({ ...fields, NODE_ENV: "production" })).toThrow(/production/i);
    expect(() => loadRealtimeConfig({ ...fields, REALTIME_HOST: "0.0.0.0" })).toThrow(/loopback/i);
    expect(() => loadRealtimeConfig({ ...fields, REALTIME_PHYSICAL_DEV_TOKEN: "short" })).toThrow(/64.*hex/i);
  });

  it("never includes configured development secrets in validation errors", () => {
    const secret = "b".repeat(64);
    let message = "";
    try { loadRealtimeConfig({ REALTIME_PHYSICAL_DEV_TOKEN: secret }); }
    catch (error) { message = (error as Error).message; }
    expect(message).toBeTruthy();
    expect(message).not.toContain(secret);
  });
});
