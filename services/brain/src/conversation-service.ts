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

export interface ConversationMemoryStore {
  retrieve(input: {
    userId: string;
    companionId: string;
    query: string;
    limit: number;
  }): Promise<ConversationMemory[]>;
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
  memory: ConversationMemoryStore;
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
      : await dependencies.memory.retrieve({
          userId: request.userId,
          companionId: request.companionId,
          query: request.userMessage,
          limit: policy.useMemory === "memory" ? 8 : 4,
        });

  const text = await dependencies.model.generate({
    userMessage: request.userMessage,
    policy,
    memories,
    relationship,
  });

  if (dependencies.events) {
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
