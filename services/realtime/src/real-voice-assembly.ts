import type { AsrProvider, AudioPipeline, TtsProvider } from "../../../runtimes/realtime-device/src/audio-pipeline";
import { DefaultModelRouter, type ModelProvider } from "../../brain/src/model-router";
import { OpenAiBrainModelProvider } from "../../brain/src/openai-model-provider";
import { MemoryIsolatedVoiceModel } from "../../brain/src/voice-model-boundary";
import { createMemoryService } from "../../memory/src/service";
import { PostgresMemoryRepository, type SqlClient } from "../../memory/src/postgres-repository";
import { BrainLlmProvider } from "./brain-llm";
import type { RealtimeConfig } from "./config";
import { createDefaultRealtimeProviderFactories, createRealtimePipeline,
  type ProviderOptions, type RealtimeProviderFactories } from "./provider-registry";

export interface RealVoiceProviderBoundaries {
  readonly asr?: Readonly<Record<string, (options?: ProviderOptions) => AsrProvider>>;
  readonly model?: Readonly<Record<string, (options?: ProviderOptions) => ModelProvider>>;
  readonly tts?: Readonly<Record<string, (options?: ProviderOptions) => TtsProvider>>;
}

function requiredOption(options: ProviderOptions | undefined, name: string): string {
  const value = options?.[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Brain model option "${name}" is required`);
  return value;
}

export function createRealVoicePipeline(
  config: NonNullable<RealtimeConfig["realVoice"]>,
  database: SqlClient,
  providers: RealVoiceProviderBoundaries = {},
): AudioPipeline {
  const modelFactories: Record<string, (options?: ProviderOptions) => ModelProvider> = {
    openai: (options) => new OpenAiBrainModelProvider({
      apiKey: requiredOption(options, "apiKey"), model: requiredOption(options, "model"),
      baseUrl: typeof options?.baseUrl === "string" ? options.baseUrl : undefined,
    }),
    ...providers.model,
  };
  const modelFactory = modelFactories[config.model.provider];
  if (!modelFactory) throw new Error(`Unsupported Brain model provider: ${config.model.provider}`);
  const modelProvider = modelFactory(config.model.options);
  if (!modelProvider.supports.includes("fast_chat")) {
    throw new Error("Selected Brain model provider does not support fast_chat");
  }
  const brain = new BrainLlmProvider(config.companionId, {
    memory: createMemoryService(new PostgresMemoryRepository(database)),
    // Explicit first-turn-only relationship baseline; no persistent relationship source is claimed.
    relationship: { async get() { return { stage: "new" as const, userInitiative: 0 }; } },
    model: new MemoryIsolatedVoiceModel(new DefaultModelRouter([modelProvider], { fast_chat: modelProvider.id })),
  });
  const defaults = createDefaultRealtimeProviderFactories(brain);
  const factories: RealtimeProviderFactories = {
    ...defaults,
    asr: { ...defaults.asr, ...providers.asr },
    tts: { ...defaults.tts, ...providers.tts },
  };
  return createRealtimePipeline({
    vad: { provider: "demo" }, // Push-to-talk controls endpointing in M2-B.
    asr: config.asr,
    llm: { provider: "brain" },
    tts: config.tts,
  }, factories);
}
