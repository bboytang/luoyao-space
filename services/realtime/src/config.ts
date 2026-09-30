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

  if (llm === "openai" && (!apiKey || !model)) {
    throw new Error("OPENAI_API_KEY and OPENAI_MODEL are required when REALTIME_LLM_PROVIDER=openai");
  }

  return {
    host: env.REALTIME_HOST?.trim() || "127.0.0.1",
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
  };
}
