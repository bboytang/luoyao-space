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
    readonly apiKey: string;
    readonly asrModel: string;
    readonly brainModel: string;
    readonly ttsModel: string;
    readonly ttsVoice: string;
    readonly companionId: string;
    readonly databaseUrl: string;
    readonly asrUrl?: string;
    readonly baseUrl?: string;
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

export function loadRealtimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): RealtimeConfig {
  const llm = readProvider("REALTIME_LLM_PROVIDER", env.REALTIME_LLM_PROVIDER);
  const asr = readProvider("REALTIME_ASR_PROVIDER", env.REALTIME_ASR_PROVIDER);
  const tts = readProvider("REALTIME_TTS_PROVIDER", env.REALTIME_TTS_PROVIDER);
  const apiKey = readOptionalString(env.OPENAI_API_KEY);
  const model = readOptionalString(env.OPENAI_MODEL);
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

  if (llm === "openai" && (!apiKey || !model)) {
    throw new Error("OPENAI_API_KEY and OPENAI_MODEL are required when REALTIME_LLM_PROVIDER=openai");
  }
  if (llm === "openai" && !(developmentEnabled && legacyV1)) {
    throw new Error("Direct OpenAI LLM is restricted to explicit v1 development compatibility; v2 voice requires Brain");
  }

  const realSelected = asr === "openai" || llm === "brain" || tts === "openai";
  let realVoice: RealtimeConfig["realVoice"];
  if (realSelected) {
    if (asr !== "openai" || llm !== "brain" || tts !== "openai") {
      throw new Error("A complete real voice provider set requires OpenAI ASR, Brain and OpenAI TTS");
    }
    if (env.REALTIME_BRAIN_MODEL_PROVIDER !== "openai") {
      throw new Error("REALTIME_BRAIN_MODEL_PROVIDER=openai must be explicitly configured");
    }
    if (env.REALTIME_RELATIONSHIP_MODE !== "initial") {
      throw new Error("REALTIME_RELATIONSHIP_MODE=initial must be explicitly configured for the M2-B first-turn context");
    }
    const asrModel = readOptionalString(env.OPENAI_ASR_MODEL);
    const ttsModel = readOptionalString(env.OPENAI_TTS_MODEL);
    const ttsVoice = readOptionalString(env.OPENAI_TTS_VOICE);
    const companionId = readOptionalString(env.REALTIME_COMPANION_ID);
    const databaseUrl = readOptionalString(env.DATABASE_URL);
    if (!apiKey || !model || !asrModel || !ttsModel || !ttsVoice || !companionId || !databaseUrl) {
      throw new Error("Real voice requires OPENAI_API_KEY, OPENAI_MODEL, OPENAI_ASR_MODEL, OPENAI_TTS_MODEL, OPENAI_TTS_VOICE, REALTIME_COMPANION_ID and DATABASE_URL");
    }
    realVoice = { apiKey, asrModel, brainModel: model, ttsModel, ttsVoice, companionId, databaseUrl,
      asrUrl: readOptionalString(env.OPENAI_ASR_URL), baseUrl: readOptionalString(env.OPENAI_BASE_URL) };
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
