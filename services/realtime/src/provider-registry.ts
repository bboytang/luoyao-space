import type {
  AsrProvider,
  AudioPipeline,
  LlmProvider,
  TtsProvider,
  VadProvider,
} from "../../../runtimes/realtime-device/src/audio-pipeline";
import { OpenAiLlmProvider } from "./providers/openai-llm";

export interface ProviderOptions {
  readonly [key: string]: unknown;
}

export interface ProviderSelection {
  readonly provider: string;
  readonly options?: ProviderOptions;
}

export interface RealtimeProviderConfig {
  readonly vad: ProviderSelection;
  readonly asr: ProviderSelection;
  readonly llm: ProviderSelection;
  readonly tts: ProviderSelection;
}

export interface RealtimeProviderFactories {
  readonly vad: Record<string, (options?: ProviderOptions) => VadProvider>;
  readonly asr: Record<string, (options?: ProviderOptions) => AsrProvider>;
  readonly llm: Record<string, (options?: ProviderOptions) => LlmProvider>;
  readonly tts: Record<string, (options?: ProviderOptions) => TtsProvider>;
}

function requireStringOption(options: ProviderOptions | undefined, name: string): string {
  const value = options?.[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Provider option "${name}" is required`);
  }
  return value;
}

export function createDefaultRealtimeProviderFactories(): RealtimeProviderFactories {
  return {
    vad: {},
    asr: {},
    llm: {
      openai: (options) =>
        new OpenAiLlmProvider({
          apiKey: requireStringOption(options, "apiKey"),
          model: requireStringOption(options, "model"),
          baseUrl: typeof options?.baseUrl === "string" ? options.baseUrl : undefined,
        }),
    },
    tts: {},
  };
}

export function validateRealtimeProviderConfig(config: RealtimeProviderConfig): void {
  const selections: Array<[keyof RealtimeProviderConfig, ProviderSelection]> = [
    ["vad", config.vad],
    ["asr", config.asr],
    ["llm", config.llm],
    ["tts", config.tts],
  ];

  for (const [kind, selection] of selections) {
    if (!selection || typeof selection.provider !== "string" || !selection.provider.trim()) {
      throw new Error(`Invalid ${kind} provider configuration`);
    }
  }
}

function createProvider<T>(
  kind: keyof RealtimeProviderFactories,
  selection: ProviderSelection,
  factories: RealtimeProviderFactories,
): T {
  const factory = factories[kind][selection.provider] as
    | ((options?: ProviderOptions) => T)
    | undefined;

  if (!factory) {
    throw new Error(`Unsupported ${kind} provider: ${selection.provider}`);
  }

  return factory(selection.options);
}

export function createRealtimePipeline(
  config: RealtimeProviderConfig,
  factories: RealtimeProviderFactories,
): AudioPipeline {
  validateRealtimeProviderConfig(config);

  return {
    vad: createProvider<VadProvider>("vad", config.vad, factories),
    asr: createProvider<AsrProvider>("asr", config.asr, factories),
    llm: createProvider<LlmProvider>("llm", config.llm, factories),
    tts: createProvider<TtsProvider>("tts", config.tts, factories),
  };
}
