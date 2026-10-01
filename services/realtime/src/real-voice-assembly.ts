import type { AsrProvider, AudioPipeline, TtsProvider } from "../../../runtimes/realtime-device/src/audio-pipeline";
import { DefaultModelRouter, type ModelProvider } from "../../brain/src/model-router";
import { OpenAiBrainModelProvider } from "../../brain/src/openai-model-provider";
import { MemoryIsolatedVoiceModel } from "../../brain/src/voice-model-boundary";
import { createMemoryService } from "../../memory/src/service";
import { PostgresMemoryRepository, type SqlClient } from "../../memory/src/postgres-repository";
import { BrainLlmProvider } from "./brain-llm";
import type { RealtimeConfig } from "./config";
import { createDefaultRealtimeProviderFactories, createRealtimePipeline } from "./provider-registry";

export interface RealVoiceProviderBoundaries {
  readonly asr?: AsrProvider;
  readonly model?: ModelProvider;
  readonly tts?: TtsProvider;
}

export function createRealVoicePipeline(
  config: NonNullable<RealtimeConfig["realVoice"]>,
  database: SqlClient,
  providers: RealVoiceProviderBoundaries = {},
): AudioPipeline {
  const modelProvider = providers.model ?? new OpenAiBrainModelProvider({
    apiKey: config.apiKey, model: config.brainModel, baseUrl: config.baseUrl,
  });
  const brain = new BrainLlmProvider(config.companionId, {
    memory: createMemoryService(new PostgresMemoryRepository(database)),
    // Explicit first-turn-only relationship baseline; no persistent relationship source is claimed.
    relationship: { async get() { return { stage: "new" as const, userInitiative: 0 }; } },
    model: new MemoryIsolatedVoiceModel(new DefaultModelRouter([modelProvider], { fast_chat: modelProvider.id })),
  });
  const defaults = createDefaultRealtimeProviderFactories(brain);
  const factories = {
    ...defaults,
    asr: { ...defaults.asr, ...(providers.asr ? { openai: () => providers.asr! } : {}) },
    tts: { ...defaults.tts, ...(providers.tts ? { openai: () => providers.tts! } : {}) },
  };
  return createRealtimePipeline({
    vad: { provider: "demo" }, // Push-to-talk controls endpointing in M2-B.
    asr: { provider: "openai", options: { apiKey: config.apiKey, model: config.asrModel, url: config.asrUrl } },
    llm: { provider: "brain" },
    tts: { provider: "openai", options: { apiKey: config.apiKey, model: config.ttsModel,
      voice: config.ttsVoice, baseUrl: config.baseUrl } },
  }, factories);
}
