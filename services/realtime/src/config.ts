import type { ProviderSelection } from "./provider-registry";

export interface RealtimeConfig {
  readonly host: string;
  readonly port: number;
  readonly providers: {
    readonly vad: string;
    readonly asr: string;
    readonly llm: string;
    readonly tts: string;
  };
  readonly openai?: {
    readonly apiKey: string;
    readonly model: string;
    readonly baseUrl?: string;
  };
  readonly realVoice?: {
    readonly asr: ProviderSelection;
    readonly model: ProviderSelection;
    readonly tts: ProviderSelection;
    readonly companionId: string;
    readonly databaseUrl: string;
  };
  readonly development: {
    readonly enabled: boolean;
    readonly legacyV1: boolean;
    readonly identity?: { readonly userId: string; readonly deviceId: string };
  };
  readonly physicalDevelopment?: {
    readonly token: string;
    readonly userId: string;
    readonly deviceId: string;
  };
}

function readOptIn(name: string, value: string | undefined): boolean {
  if (value === undefined) return false;
  if (value === "1") return true;
  throw new Error(`${name} must be 1 when explicitly enabled`);
}

function readPort(value: string | undefined): number {
  const port = Number(value ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("REALTIME_PORT must be an integer between 1 and 65535");
  }
  return port;
}

function readProvider(name: string, value: string | undefined): string {
  const provider = value?.trim() || "demo";
  if (!/^[a-z0-9_-]+$/i.test(provider)) {
    throw new Error(`${name} must contain only letters, numbers, hyphens, or underscores`);
  }
  return provider;
}

function readOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function requireOpenAiOption(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required for the selected OpenAI provider`);
  return value;
}

function requireAlibabaOption(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required for the selected Alibaba provider`);
  return value;
}

function requireAlibabaModel(value: string | undefined, expected: string, kind: string): string {
  if (value !== expected) throw new Error(`Alibaba ${kind} model must be ${expected}`);
  return value;
}

function requireAlibabaUrl(value: string | undefined, kind: "ASR WebSocket" | "Brain base" | "TTS WebSocket"): string {
  if (!value) throw new Error(`Alibaba ${kind} URL is required`);
  try {
    const url = new URL(value);
    const websocket = kind !== "Brain base";
    const expectedPath = websocket ? "/api-ws/v1/inference" : "/compatible-mode/v1";
    if (url.protocol !== (websocket ? "wss:" : "https:") || url.username || url.password ||
      url.search || url.hash || url.pathname.replace(/\/$/, "") !== expectedPath ||
      !url.hostname.endsWith(".cn-beijing.maas.aliyuncs.com")) {
      throw new Error("invalid");
    }
  } catch {
    throw new Error(`Alibaba ${kind} URL must be a secure Beijing workspace endpoint`);
  }
  return value.replace(/\/$/, "");
}

export function loadRealtimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): RealtimeConfig {
  const llm = readProvider("REALTIME_LLM_PROVIDER", env.REALTIME_LLM_PROVIDER);
  const asr = readProvider("REALTIME_ASR_PROVIDER", env.REALTIME_ASR_PROVIDER);
  const tts = readProvider("REALTIME_TTS_PROVIDER", env.REALTIME_TTS_PROVIDER);
  const apiKey = readOptionalString(env.OPENAI_API_KEY);
  const model = readOptionalString(env.OPENAI_MODEL);
  const alibabaApiKey = readOptionalString(env.ALIBABA_API_KEY);
  const host = env.REALTIME_HOST?.trim() || "127.0.0.1";
  const developmentEnabled = readOptIn("REALTIME_DEV_MODE", env.REALTIME_DEV_MODE);
  const legacyV1 = readOptIn("REALTIME_DEV_V1_COMPAT", env.REALTIME_DEV_V1_COMPAT);
  const devUserId = readOptionalString(env.REALTIME_DEV_USER_ID);
  const devDeviceId = readOptionalString(env.REALTIME_DEV_DEVICE_ID);
  const physicalEnabled = readOptIn("REALTIME_PHYSICAL_DEV_MODE", env.REALTIME_PHYSICAL_DEV_MODE);
  const physicalToken = readOptionalString(env.REALTIME_PHYSICAL_DEV_TOKEN);
  const physicalUserId = readOptionalString(env.REALTIME_PHYSICAL_DEV_USER_ID);
  const physicalDeviceId = readOptionalString(env.REALTIME_PHYSICAL_DEV_DEVICE_ID);

  if (physicalEnabled && (developmentEnabled || legacyV1)) {
    throw new Error("Physical-device authentication and loopback development bypass are mutually exclusive");
  }
  if (!physicalEnabled && [env.REALTIME_PHYSICAL_DEV_TOKEN, env.REALTIME_PHYSICAL_DEV_USER_ID,
    env.REALTIME_PHYSICAL_DEV_DEVICE_ID].some((value) => value !== undefined)) {
    throw new Error("Physical-device development mode must be explicitly enabled for its credentials");
  }
  if (physicalEnabled) {
    if (env.NODE_ENV === "production") throw new Error("Physical-device development mode is forbidden in production");
    if (host !== "127.0.0.1" && host !== "::1") {
      throw new Error("Physical-device development mode requires a loopback host");
    }
    if (!physicalToken || !physicalUserId || !physicalDeviceId) {
      throw new Error("Physical-device development mode requires token, user ID and device ID");
    }
    if (!/^[0-9a-f]{64}$/.test(physicalToken)) {
      throw new Error("Physical-device development token must be 64 lowercase hex characters");
    }
  }

  if (legacyV1 && !developmentEnabled) throw new Error("v1 compatibility requires explicit development mode");
  if (!developmentEnabled && (env.REALTIME_DEV_USER_ID !== undefined || env.REALTIME_DEV_DEVICE_ID !== undefined)) {
    throw new Error("Development identity requires explicit development mode");
  }
  if (developmentEnabled) {
    if (env.NODE_ENV === "production") throw new Error("Development mode is forbidden in production");
    if (host !== "127.0.0.1" && host !== "::1") throw new Error("Development mode requires a loopback host");
    if ((env.REALTIME_DEV_USER_ID !== undefined || env.REALTIME_DEV_DEVICE_ID !== undefined) &&
        (!devUserId || !devDeviceId)) {
      throw new Error("Development identity requires both user and device IDs");
    }
  }

  if (llm !== "demo" && llm !== "brain" && llm !== "openai") {
    throw new Error("Unsupported realtime LLM provider; v2 real voice requires Brain");
  }
  if (llm === "openai" && (!apiKey || !model)) {
    throw new Error("OPENAI_API_KEY and OPENAI_MODEL are required when REALTIME_LLM_PROVIDER=openai");
  }
  if (llm === "openai" && !(developmentEnabled && legacyV1)) {
    throw new Error("Direct OpenAI LLM is restricted to explicit v1 development compatibility; v2 voice requires Brain");
  }

  const modelProvider = readOptionalString(env.REALTIME_BRAIN_MODEL_PROVIDER);
  const realSelected = asr !== "demo" || llm === "brain" || tts !== "demo" || modelProvider !== undefined;
  let realVoice: RealtimeConfig["realVoice"];
  if (realSelected) {
    if (llm !== "brain" || asr === "demo" || tts === "demo" || !modelProvider) {
      throw new Error("A complete real voice provider set requires ASR, Brain, REALTIME_BRAIN_MODEL_PROVIDER and TTS selections");
    }
    if (env.REALTIME_RELATIONSHIP_MODE !== "initial") {
      throw new Error("REALTIME_RELATIONSHIP_MODE=initial must be explicitly configured for the M2-B first-turn context");
    }
    const companionId = readOptionalString(env.REALTIME_COMPANION_ID);
    const databaseUrl = readOptionalString(env.DATABASE_URL);
    if (!companionId || !databaseUrl) {
      throw new Error("Real voice requires REALTIME_COMPANION_ID and DATABASE_URL");
    }
    if (asr !== "openai" && asr !== "alibaba") throw new Error("Unsupported ASR provider");
    if (modelProvider !== "openai" && modelProvider !== "alibaba") {
      throw new Error("Unsupported REALTIME_BRAIN_MODEL_PROVIDER");
    }
    if (tts !== "openai" && tts !== "alibaba") throw new Error("Unsupported TTS provider");
    let asrSelection: ProviderSelection;
    if (asr === "openai") {
      asrSelection = { provider: asr, options: {
        apiKey: requireOpenAiOption(readOptionalString(env.OPENAI_ASR_API_KEY) ?? apiKey,
          "OPENAI_ASR_API_KEY or OPENAI_API_KEY"),
        model: requireOpenAiOption(readOptionalString(env.OPENAI_ASR_MODEL), "OPENAI_ASR_MODEL"),
        url: readOptionalString(env.OPENAI_ASR_URL),
      } };
    } else if (asr === "alibaba") {
      asrSelection = { provider: asr, options: {
        apiKey: requireAlibabaOption(readOptionalString(env.ALIBABA_ASR_API_KEY) ?? alibabaApiKey,
          "ALIBABA_ASR_API_KEY or ALIBABA_API_KEY"),
        model: requireAlibabaModel(readOptionalString(env.ALIBABA_ASR_MODEL), "paraformer-realtime-v2", "ASR"),
        url: requireAlibabaUrl(readOptionalString(env.ALIBABA_ASR_WS_URL), "ASR WebSocket"),
      } };
    } else {
      throw new Error("Unsupported ASR provider");
    }

    let modelSelection: ProviderSelection;
    if (modelProvider === "openai") {
      modelSelection = { provider: modelProvider, options: {
        apiKey: requireOpenAiOption(readOptionalString(env.OPENAI_BRAIN_API_KEY) ?? apiKey,
          "OPENAI_BRAIN_API_KEY or OPENAI_API_KEY"),
        model: requireOpenAiOption(model, "OPENAI_MODEL"),
        baseUrl: readOptionalString(env.OPENAI_BRAIN_BASE_URL) ?? readOptionalString(env.OPENAI_BASE_URL),
      } };
    } else if (modelProvider === "alibaba") {
      modelSelection = { provider: modelProvider, options: {
        apiKey: requireAlibabaOption(readOptionalString(env.ALIBABA_BRAIN_API_KEY) ?? alibabaApiKey,
          "ALIBABA_BRAIN_API_KEY or ALIBABA_API_KEY"),
        model: requireAlibabaModel(readOptionalString(env.ALIBABA_BRAIN_MODEL), "qwen-flash", "Brain"),
        baseUrl: requireAlibabaUrl(readOptionalString(env.ALIBABA_BRAIN_BASE_URL), "Brain base"),
      } };
    } else {
      throw new Error("Unsupported REALTIME_BRAIN_MODEL_PROVIDER");
    }

    let ttsSelection: ProviderSelection;
    if (tts === "openai") {
      ttsSelection = { provider: tts, options: {
        apiKey: requireOpenAiOption(readOptionalString(env.OPENAI_TTS_API_KEY) ?? apiKey,
          "OPENAI_TTS_API_KEY or OPENAI_API_KEY"),
        model: requireOpenAiOption(readOptionalString(env.OPENAI_TTS_MODEL), "OPENAI_TTS_MODEL"),
        voice: requireOpenAiOption(readOptionalString(env.OPENAI_TTS_VOICE), "OPENAI_TTS_VOICE"),
        baseUrl: readOptionalString(env.OPENAI_TTS_BASE_URL) ?? readOptionalString(env.OPENAI_BASE_URL),
      } };
    } else if (tts === "alibaba") {
      ttsSelection = { provider: tts, options: {
        apiKey: requireAlibabaOption(readOptionalString(env.ALIBABA_TTS_API_KEY) ?? alibabaApiKey,
          "ALIBABA_TTS_API_KEY or ALIBABA_API_KEY"),
        model: requireAlibabaModel(readOptionalString(env.ALIBABA_TTS_MODEL), "cosyvoice-v3.5-flash", "TTS"),
        voice: requireAlibabaOption(readOptionalString(env.ALIBABA_TTS_VOICE_ID), "ALIBABA_TTS_VOICE_ID"),
        url: requireAlibabaUrl(readOptionalString(env.ALIBABA_TTS_WS_URL), "TTS WebSocket"),
      } };
    } else {
      throw new Error("Unsupported TTS provider");
    }
    realVoice = {
      asr: asrSelection,
      model: modelSelection,
      tts: ttsSelection,
      companionId, databaseUrl,
    };
  }

  return {
    host,
    port: readPort(env.REALTIME_PORT),
    providers: {
      vad: readProvider("REALTIME_VAD_PROVIDER", env.REALTIME_VAD_PROVIDER),
      asr,
      llm,
      tts,
    },
    openai: apiKey && model
      ? {
          apiKey,
          model,
          baseUrl: readOptionalString(env.OPENAI_BASE_URL),
        }
      : undefined,
    realVoice,
    development: {
      enabled: developmentEnabled,
      legacyV1,
      identity: devUserId && devDeviceId ? { userId: devUserId, deviceId: devDeviceId } : undefined,
    },
    physicalDevelopment: physicalEnabled && physicalToken && physicalUserId && physicalDeviceId
      ? { token: physicalToken, userId: physicalUserId, deviceId: physicalDeviceId }
      : undefined,
  };
}
