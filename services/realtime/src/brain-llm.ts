import type { AudioStreamContext, LlmEvent, LlmInput, LlmProvider } from "../../../runtimes/realtime-device/src/audio-pipeline";
import type { ConversationServiceDependencies } from "../../brain/src/conversation-service";
import { respondToConversation } from "../../brain/src/conversation-service";
import type { MemoryIsolatedVoiceModel } from "../../brain/src/voice-model-boundary";
import { createBrainTurnSeed } from "./brain-context";

type VoiceBrainDependencies = Omit<ConversationServiceDependencies, "model"> & { model: MemoryIsolatedVoiceModel };

export class BrainLlmProvider implements LlmProvider {
  constructor(private readonly companionId: string, private readonly dependencies: VoiceBrainDependencies) {
    if (!companionId.trim()) throw new Error("Brain companion ID is required");
  }

  async *stream(input: LlmInput, context: AudioStreamContext): AsyncIterable<LlmEvent> {
    const seed = createBrainTurnSeed(context, input.text);
    if (context.signal.aborted) {
      yield { type: "done", finishReason: "abort" };
      return;
    }
    // Neutral first-turn signals: transport does not assert relationship history or emotion telemetry.
    const response = await respondToConversation({
      userId: seed.userId,
      companionId: this.companionId,
      sessionId: seed.transportSessionId,
      userMessage: seed.userMessage,
      signal: context.signal,
      signals: { userMessage: seed.userMessage, recentQuestionCount: 0, recentAdviceCount: 0,
        emotionalIntensity: 0, topicIsTaskLike: false },
    }, this.dependencies);
    if (context.signal.aborted) {
      yield { type: "done", finishReason: "abort" };
      return;
    }
    if (!response.text.trim()) throw new Error("Brain returned an empty response");
    yield { type: "sentence", text: response.text };
    yield { type: "done", finishReason: "stop" };
  }
}
