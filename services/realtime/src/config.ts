export interface RealtimeConfig {
  readonly host: string;
  readonly port: number;
  readonly providers: {
    readonly vad: string;
    readonly asr: string;
    readonly llm: string;
    readonly tts: string;
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

export function loadRealtimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): RealtimeConfig {
  return {
    host: env.REALTIME_HOST?.trim() || "127.0.0.1",
    port: readPort(env.REALTIME_PORT),
    providers: {
      vad: readProvider("REALTIME_VAD_PROVIDER", env.REALTIME_VAD_PROVIDER),
      asr: readProvider("REALTIME_ASR_PROVIDER", env.REALTIME_ASR_PROVIDER),
      llm: readProvider("REALTIME_LLM_PROVIDER", env.REALTIME_LLM_PROVIDER),
      tts: readProvider("REALTIME_TTS_PROVIDER", env.REALTIME_TTS_PROVIDER),
    },
  };
}
