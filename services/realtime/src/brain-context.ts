import type { AudioStreamContext } from "../../../runtimes/realtime-device/src/audio-pipeline";
import type { ConversationRequest } from "../../brain/src/conversation-service";

export interface RealtimeBrainTurnSeed extends Pick<ConversationRequest, "userId" | "userMessage"> {
  userId: string;
  authorizedDeviceId: string;
  transportSessionId: string;
  conversationId: string;
  userMessage: string;
}

export function createBrainTurnSeed(context: AudioStreamContext, userMessage: string): RealtimeBrainTurnSeed {
  const identity = context.trustedIdentity;
  if (!identity?.userId?.trim() || !identity.authorizedDeviceId?.trim()) {
    throw new Error("Trusted admitted identity is required for a Brain turn");
  }
  return {
    userId: identity.userId,
    authorizedDeviceId: identity.authorizedDeviceId,
    transportSessionId: context.sessionId,
    conversationId: context.conversationId,
    userMessage,
  };
}
