import type { ModelRouter } from "./model-router";
import type { MemoryService } from "../../memory/src/service";
import type { MemoryWriteSignals } from "../../memory/src/write-policy";
import {
  directConversation,
  type BehaviorPolicy,
  type ConversationSignals,
} from "./conversation-director";

export interface ConversationMemory {
  id: string;
  content: string;
  relevance: number;
}

export interface RelationshipSnapshot {
  stage: ConversationSignals["relationshipStage"];
  userInitiative: number;
}

export interface ConversationModelRequest {
  userMessage: string;
  policy: BehaviorPolicy;
  memories: ConversationMemory[];
  relationship: RelationshipSnapshot;
}

export interface ConversationModel {
  generate(request: ConversationModelRequest): Promise<string>;
}

export class RoutedConversationModel implements ConversationModel {
  constructor(private readonly router: ModelRouter) {}

  async generate(request: ConversationModelRequest): Promise<string> {
    const result = await this.router.generate({
      modelClass: "fast_chat",
      input: request,
    });
    return result.text;
  }
}

export interface ConversationRelationshipStore {
  get(input: {
    userId: string;
    companionId: string;
  }): Promise<RelationshipSnapshot>;
}

export interface ConversationEventSink {
  emit(event: {
    type: "conversation.created" | "conversation.updated" | "emotion.changed";
    userId: string;
    companionId: string;
    sessionId?: string;
    data: Record<string, unknown>;
  }): Promise<void>;
}

export interface ConversationRequest {
  userId: string;
  companionId: string;
  sessionId?: string;
  userMessage: string;
  memoryWriteSignals?: Omit<MemoryWriteSignals, "userMessage">;
  signals: Omit<ConversationSignals, "relationshipStage" | "userInitiative"> & {
    recentQuestionCount: number;
    recentAdviceCount: number;
    emotionalIntensity: number;
    topicIsTaskLike: boolean;
  };
}

export interface ConversationResponse {
  text: string;
  policy: BehaviorPolicy;
  memories: ConversationMemory[];
}

export interface ConversationServiceDependencies {
  memory: Pick<MemoryService, "recall">;
  relationship: ConversationRelationshipStore;
  model: ConversationModel;
  events?: ConversationEventSink;
}

export async function respondToConversation(
  request: ConversationRequest,
  dependencies: ConversationServiceDependencies,
): Promise<ConversationResponse> {
  const relationship = await dependencies.relationship.get({
    userId: request.userId,
    companionId: request.companionId,
  });

  const signals: ConversationSignals = {
    ...request.signals,
    relationshipStage: relationship.stage,
    userInitiative: relationship.userInitiative,
  };

  const policy = directConversation(signals);

  const memories =
    policy.useMemory === "none"
      ? []
      : (await dependencies.memory.recall({
          userId: request.userId,
          companionId: request.companionId,
          query: request.userMessage,
          limit: policy.useMemory === "memory" ? 8 : 4,
          now: new Date().toISOString(),
        })).map((memory) => ({
          id: memory.id,
          content: memory.content,
          relevance: memory.score,
        }));

  const text = await dependencies.model.generate({
    userMessage: request.userMessage,
    policy,
    memories,
    relationship,
  });

  if (dependencies.events) {
    if (request.memoryWriteSignals) {
      await dependencies.events.emit({
        type: "memory.write.requested",
        userId: request.userId,
        companionId: request.companionId,
        sessionId: request.sessionId,
        data: {
          userMessage: request.userMessage,
          signals: request.memoryWriteSignals,
        },
      });
    }
    await dependencies.events.emit({
      type: "conversation.updated",
      userId: request.userId,
      companionId: request.companionId,
      sessionId: request.sessionId,
      data: {
        userMessage: request.userMessage,
        response: text,
        responseLength: policy.responseLength,
        action: policy.action,
      },
    });

    await dependencies.events.emit({
      type: "emotion.changed",
      userId: request.userId,
      companionId: request.companionId,
      sessionId: request.sessionId,
      data: {
        emotion: policy.emotion,
        intensity: policy.emotionIntensity,
      },
    });
  }

  return { text, policy, memories };
}
