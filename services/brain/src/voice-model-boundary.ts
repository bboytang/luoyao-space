import type { ConversationModel, ConversationModelRequest } from "./conversation-service";
import type { ModelRouter } from "./model-router";

/** External-provider-safe current-turn context: no long-term memory or identity fields. */
export interface VoiceModelContext {
  transcript: string;
  responseLength: "very_short" | "short" | "normal" | "long";
  responseTone: "calm" | "warm" | "playful" | "serious" | "curious";
}

export class MemoryIsolatedVoiceModel implements ConversationModel {
  constructor(private readonly router: ModelRouter) {}
  async generate(request: ConversationModelRequest): Promise<string> {
    // Build a fresh allowlist object. Neither memories nor relationship/identity metadata
    // can cross this boundary, regardless of which provider the router selects.
    const input: VoiceModelContext = {
      transcript: request.userMessage,
      responseLength: request.policy.responseLength,
      responseTone: request.policy.emotion,
    };
    const result = await this.router.generate({ modelClass: "fast_chat", input,
      ...(request.signal ? { signal: request.signal } : {}) });
    return result.text;
  }
}
