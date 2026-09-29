import type { MemoryService, RememberCandidateResult } from "./service";
import type { MemoryWriteSignals } from "./write-policy";

export interface MemoryWriteRequestedEvent {
  type: "memory.write.requested";
  userId: string;
  companionId: string;
  data: {
    userMessage: string;
    signals: Omit<MemoryWriteSignals, "userMessage">;
  };
}

export async function consumeMemoryWriteRequested(
  event: MemoryWriteRequestedEvent,
  memory: Pick<MemoryService, "rememberCandidate">,
): Promise<RememberCandidateResult> {
  if (!event.data.userMessage.trim()) {
    throw new Error("Memory write event userMessage must not be empty");
  }

  return memory.rememberCandidate({
    userId: event.userId,
    companionId: event.companionId,
    userMessage: event.data.userMessage,
    ...event.data.signals,
  });
}