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

  it("rejects incomplete direct provider selections without exposing unrelated secrets", () => {
    expect(() =>
      loadRealtimeConfig({
        REALTIME_HOST: "0.0.0.0",
        REALTIME_PORT: "9000",
        REALTIME_VAD_PROVIDER: "demo",
        REALTIME_ASR_PROVIDER: "cloud_asr",
        REALTIME_LLM_PROVIDER: "cloud_llm",
        REALTIME_TTS_PROVIDER: "cloud_tts",
        CLOUD_LLM_API_KEY: "should-not-be-read",
      }),
    ).toThrow(/Brain|unsupported/i);
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
      asr: { provider: "openai", options: { model: "asr-model" } },
      model: { provider: "openai", options: { model: "brain-model" } },
      tts: { provider: "openai", options: { model: "tts-model", voice: "alloy" } },
      companionId: "luoyao", databaseUrl: "postgresql://example.test/luoyao",
    });
    expect(() => loadRealtimeConfig({ ...real, OPENAI_API_KEY: "" })).toThrow(/OPENAI_API_KEY/);
    expect(() => loadRealtimeConfig({ ...real, REALTIME_TTS_PROVIDER: "demo" })).toThrow(/complete real voice/i);
    expect(() => loadRealtimeConfig({ ...real, REALTIME_BRAIN_MODEL_PROVIDER: "" })).toThrow(/BRAIN_MODEL_PROVIDER/);
    expect(() => loadRealtimeConfig({ REALTIME_LLM_PROVIDER: "openai", OPENAI_API_KEY: "key", OPENAI_MODEL: "m" })).toThrow(/v1 development/i);
  });

  it("keeps stage-specific credentials independent while preserving legacy OpenAI configuration", () => {
    const config = loadRealtimeConfig({
      REALTIME_ASR_PROVIDER: "openai", REALTIME_LLM_PROVIDER: "brain", REALTIME_TTS_PROVIDER: "openai",
      REALTIME_BRAIN_MODEL_PROVIDER: "openai", REALTIME_RELATIONSHIP_MODE: "initial",
      OPENAI_ASR_API_KEY: "asr-key", OPENAI_BRAIN_API_KEY: "brain-key", OPENAI_TTS_API_KEY: "tts-key",
      OPENAI_ASR_MODEL: "asr-model", OPENAI_MODEL: "brain-model", OPENAI_TTS_MODEL: "tts-model",
      OPENAI_TTS_VOICE: "voice", REALTIME_COMPANION_ID: "luoyao", DATABASE_URL: "postgresql://example.test/luoyao",
    });
    expect(config.realVoice).toMatchObject({
      asr: { provider: "openai", options: { apiKey: "asr-key" } },
      model: { provider: "openai", options: { apiKey: "brain-key" } },
      tts: { provider: "openai", options: { apiKey: "tts-key" } },
    });
  });

  it("loads independently configured Alibaba Beijing providers without runtime fallback", () => {
    const config = loadRealtimeConfig({
      REALTIME_ASR_PROVIDER: "alibaba", REALTIME_LLM_PROVIDER: "brain", REALTIME_TTS_PROVIDER: "alibaba",
      REALTIME_BRAIN_MODEL_PROVIDER: "alibaba", REALTIME_RELATIONSHIP_MODE: "initial",
      ALIBABA_ASR_API_KEY: "asr-key", ALIBABA_ASR_WS_URL: "wss://asr-workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
      ALIBABA_ASR_MODEL: "paraformer-realtime-v2",
      ALIBABA_BRAIN_API_KEY: "brain-key", ALIBABA_BRAIN_BASE_URL: "https://brain-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      ALIBABA_BRAIN_MODEL: "qwen-flash",
      ALIBABA_TTS_API_KEY: "tts-key", ALIBABA_TTS_WS_URL: "wss://tts-workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
      ALIBABA_TTS_MODEL: "cosyvoice-v3.5-flash", ALIBABA_TTS_VOICE_ID: "voice-example",
      REALTIME_COMPANION_ID: "luoyao", DATABASE_URL: "postgresql://example.test/luoyao",
    });
    expect(config.realVoice).toEqual({
      asr: { provider: "alibaba", options: { apiKey: "asr-key", model: "paraformer-realtime-v2",
        url: "wss://asr-workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference" } },
      model: { provider: "alibaba", options: { apiKey: "brain-key", model: "qwen-flash",
        baseUrl: "https://brain-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1" } },
      tts: { provider: "alibaba", options: { apiKey: "tts-key", model: "cosyvoice-v3.5-flash",
        voice: "voice-example", url: "wss://tts-workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference" } },
      companionId: "luoyao", databaseUrl: "postgresql://example.test/luoyao",
    });
  });

  it("uses ALIBABA_API_KEY only as an explicit per-stage configuration default", () => {
    const config = loadRealtimeConfig({
      REALTIME_ASR_PROVIDER: "alibaba", REALTIME_LLM_PROVIDER: "brain", REALTIME_TTS_PROVIDER: "alibaba",
      REALTIME_BRAIN_MODEL_PROVIDER: "alibaba", REALTIME_RELATIONSHIP_MODE: "initial",
      ALIBABA_API_KEY: "shared-explicit-key",
      ALIBABA_ASR_WS_URL: "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
      ALIBABA_ASR_MODEL: "paraformer-realtime-v2",
      ALIBABA_BRAIN_BASE_URL: "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      ALIBABA_BRAIN_MODEL: "qwen-flash",
      ALIBABA_TTS_WS_URL: "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
      ALIBABA_TTS_MODEL: "cosyvoice-v3.5-flash", ALIBABA_TTS_VOICE_ID: "voice-example",
      REALTIME_COMPANION_ID: "luoyao", DATABASE_URL: "postgresql://example.test/luoyao",
    });
    expect(config.realVoice?.asr.options?.apiKey).toBe("shared-explicit-key");
    expect(config.realVoice?.model.options?.apiKey).toBe("shared-explicit-key");
    expect(config.realVoice?.tts.options?.apiKey).toBe("shared-explicit-key");
  });

  it("fails closed for incomplete or unsupported Alibaba provider configuration without echoing secrets", () => {
    const base = {
      REALTIME_ASR_PROVIDER: "alibaba", REALTIME_LLM_PROVIDER: "brain", REALTIME_TTS_PROVIDER: "alibaba",
      REALTIME_BRAIN_MODEL_PROVIDER: "alibaba", REALTIME_RELATIONSHIP_MODE: "initial",
      ALIBABA_API_KEY: "private-secret-key",
      ALIBABA_ASR_WS_URL: "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
      ALIBABA_ASR_MODEL: "paraformer-realtime-v2",
      ALIBABA_BRAIN_BASE_URL: "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      ALIBABA_BRAIN_MODEL: "qwen-flash",
      ALIBABA_TTS_WS_URL: "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
      ALIBABA_TTS_MODEL: "cosyvoice-v3.5-flash", ALIBABA_TTS_VOICE_ID: "voice-example",
      REALTIME_COMPANION_ID: "luoyao", DATABASE_URL: "postgresql://example.test/luoyao",
    };
    expect(() => loadRealtimeConfig({ ...base, ALIBABA_TTS_VOICE_ID: "" })).toThrow(/voice/i);
    expect(() => loadRealtimeConfig({ ...base, ALIBABA_ASR_MODEL: "other-asr" })).toThrow(/ASR model/i);
    expect(() => loadRealtimeConfig({ ...base, ALIBABA_BRAIN_MODEL: "other-model" })).toThrow(/Brain model/i);
    expect(() => loadRealtimeConfig({ ...base, ALIBABA_TTS_MODEL: "other-tts" })).toThrow(/TTS model/i);
    expect(() => loadRealtimeConfig({ ...base, ALIBABA_ASR_WS_URL: "https://private-secret-key.example.test/path" }))
      .toThrow(/ASR.*WebSocket/i);
    for (const mutation of [
      { ALIBABA_API_KEY: "", ALIBABA_ASR_API_KEY: "", ALIBABA_BRAIN_API_KEY: "", ALIBABA_TTS_API_KEY: "" },
      { ALIBABA_TTS_VOICE_ID: "" },
    ]) {
      let message = "";
      try { loadRealtimeConfig({ ...base, ...mutation }); } catch (error) { message = (error as Error).message; }
      expect(message).toBeTruthy();
      expect(message).not.toContain("private-secret-key");
    }
  });

  it("keeps mixed real-provider selection explicit", () => {
    const config = loadRealtimeConfig({
      REALTIME_ASR_PROVIDER: "alibaba", REALTIME_LLM_PROVIDER: "brain", REALTIME_TTS_PROVIDER: "openai",
      REALTIME_BRAIN_MODEL_PROVIDER: "alibaba", REALTIME_RELATIONSHIP_MODE: "initial",
      ALIBABA_API_KEY: "alibaba-key",
      ALIBABA_ASR_WS_URL: "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
      ALIBABA_ASR_MODEL: "paraformer-realtime-v2",
      ALIBABA_BRAIN_BASE_URL: "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      ALIBABA_BRAIN_MODEL: "qwen-flash",
      OPENAI_TTS_API_KEY: "openai-key", OPENAI_TTS_MODEL: "tts-model", OPENAI_TTS_VOICE: "voice",
      REALTIME_COMPANION_ID: "luoyao", DATABASE_URL: "postgresql://example.test/luoyao",
    });
    expect(config.realVoice?.asr.provider).toBe("alibaba");
    expect(config.realVoice?.model.provider).toBe("alibaba");
    expect(config.realVoice?.tts.provider).toBe("openai");
  });

  it("rejects unsupported real providers and a direct v2 external LLM", () => {
    const base = { REALTIME_ASR_PROVIDER: "openai", REALTIME_LLM_PROVIDER: "brain",
      REALTIME_TTS_PROVIDER: "openai", REALTIME_BRAIN_MODEL_PROVIDER: "openai",
      REALTIME_RELATIONSHIP_MODE: "initial", OPENAI_API_KEY: "key", OPENAI_ASR_MODEL: "asr",
      OPENAI_MODEL: "brain", OPENAI_TTS_MODEL: "tts", OPENAI_TTS_VOICE: "voice",
      REALTIME_COMPANION_ID: "luoyao", DATABASE_URL: "postgresql://example.test/luoyao" };
    expect(() => loadRealtimeConfig({ ...base, REALTIME_ASR_PROVIDER: "missing" })).toThrow(/unsupported.*ASR/i);
    expect(() => loadRealtimeConfig({ ...base, REALTIME_BRAIN_MODEL_PROVIDER: "missing" })).toThrow(/unsupported.*BRAIN_MODEL_PROVIDER/i);
    expect(() => loadRealtimeConfig({ ...base, REALTIME_TTS_PROVIDER: "missing" })).toThrow(/unsupported.*TTS/i);
    expect(() => loadRealtimeConfig({ ...base, REALTIME_LLM_PROVIDER: "other_llm" })).toThrow(/Brain/i);
    expect(() => loadRealtimeConfig({ REALTIME_LLM_PROVIDER: "other_llm" })).toThrow(/Brain/i);
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

  it("never echoes an invalid Brain model selection that could contain a secret", () => {
    const selection = "https://provider.test/?token=private";
    let message = "";
    try { loadRealtimeConfig({
      REALTIME_ASR_PROVIDER: "openai", REALTIME_LLM_PROVIDER: "brain", REALTIME_TTS_PROVIDER: "openai",
      REALTIME_BRAIN_MODEL_PROVIDER: selection, REALTIME_RELATIONSHIP_MODE: "initial",
      REALTIME_COMPANION_ID: "luoyao", DATABASE_URL: "postgresql://example.test/luoyao",
    }); }
    catch (error) { message = (error as Error).message; }
    expect(message).toMatch(/BRAIN_MODEL_PROVIDER/);
    expect(message).not.toContain(selection);
    expect(message).not.toContain("private");
  });
});
