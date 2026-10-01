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
  readonly development: {
    readonly enabled: boolean;
    readonly legacyV1: boolean;
    readonly identity?: { readonly userId: string; readonly deviceId: string };
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
  const apiKey = readOptionalString(env.OPENAI_API_KEY);
  const model = readOptionalString(env.OPENAI_MODEL);
  const host = env.REALTIME_HOST?.trim() || "127.0.0.1";
  const developmentEnabled = readOptIn("REALTIME_DEV_MODE", env.REALTIME_DEV_MODE);
  const legacyV1 = readOptIn("REALTIME_DEV_V1_COMPAT", env.REALTIME_DEV_V1_COMPAT);
  const devUserId = readOptionalString(env.REALTIME_DEV_USER_ID);
  const devDeviceId = readOptionalString(env.REALTIME_DEV_DEVICE_ID);

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

  return {
    host,
    port: readPort(env.REALTIME_PORT),
    providers: {
      vad: readProvider("REALTIME_VAD_PROVIDER", env.REALTIME_VAD_PROVIDER),
      asr: readProvider("REALTIME_ASR_PROVIDER", env.REALTIME_ASR_PROVIDER),
      llm,
      tts: readProvider("REALTIME_TTS_PROVIDER", env.REALTIME_TTS_PROVIDER),
    },
    openai: apiKey && model
      ? {
          apiKey,
          model,
          baseUrl: readOptionalString(env.OPENAI_BASE_URL),
        }
      : undefined,
    development: {
      enabled: developmentEnabled,
      legacyV1,
      identity: devUserId && devDeviceId ? { userId: devUserId, deviceId: devDeviceId } : undefined,
    },
  };
}
