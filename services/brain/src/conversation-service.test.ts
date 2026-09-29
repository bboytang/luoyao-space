import { describe, expect, it, vi } from "vitest";
import { respondToConversation } from "./conversation-service";

const baseRequest = {
  userId: "user-1",
  companionId: "companion-1",
  userMessage: "今天还行",
  signals: {
    userMessage: "今天还行",
    recentQuestionCount: 0,
    recentAdviceCount: 0,
    emotionalIntensity: 0.2,
    topicIsTaskLike: false,
  },
};

describe("conversation service", () => {
  it("loads relationship, recalls memory, then generates", async () => {
    const order: string[] = [];
    const memory = {
      recall: vi.fn(async () => {
        order.push("memory");
        return [{
          id: "m1",
          userId: "user-1",
          companionId: "companion-1",
          kind: "shared_history" as const,
          content: "shared history",
          importance: 0.8,
          relationshipRelevance: 0.8,
          projectRelevance: 0,
          createdAt: "2026-09-29T00:00:00Z",
          score: 0.9,
        }];
      }),
    };
    const relationship = {
      get: vi.fn(async () => {
        order.push("relationship");
        return { stage: "close" as const, userInitiative: 0.7 };
      }),
    };
    const model = {
      generate: vi.fn(async (request) => {
        order.push("model");
        expect(request.memories).toHaveLength(1);
        return "好呀。";
      }),
    };

    const response = await respondToConversation(baseRequest, {
      memory,
      relationship,
      model,
    });

    expect(response.text).toBe("好呀。");
    expect(order).toEqual(["relationship", "memory", "model"]);
  });

  it("emits a memory write request without coupling to the memory writer", async () => {
    const memory = { recall: vi.fn(async () => []) };
    const relationship = {
      get: vi.fn(async () => ({ stage: "close" as const, userInitiative: 0.5 })),
    };
    const model = { generate: vi.fn(async () => "记下啦。") };
    const emitted: Array<{ type: string; data: Record<string, unknown> }> = [];

    await respondToConversation(
      {
        ...baseRequest,
        memoryWriteSignals: { containsStablePreference: true },
      },
      {
        memory,
        relationship,
        model,
        events: {
          async emit(event) {
            emitted.push({ type: event.type, data: event.data });
          },
        },
      },
    );

    expect(emitted[0]?.type).toBe("memory.write.requested");
    expect(emitted[0]?.data).toMatchObject({
      userMessage: "今天还行",
      signals: { containsStablePreference: true },
    });
  });

  it("uses recent memory when requested by the director", async () => {
    const memory = { recall: vi.fn(async () => []) };
    const relationship = {
      get: vi.fn(async () => ({
        stage: "new" as const,
        userInitiative: 0,
      })),
    };
    const model = {
      generate: vi.fn(async () => "嗯。"),
    };

    const response = await respondToConversation(
      {
        ...baseRequest,
        userMessage: "嗯",
        signals: {
          ...baseRequest.signals,
          userMessage: "嗯",
          emotionalIntensity: 0,
        },
      },
      { memory, relationship, model },
    );

    expect(response.policy.useMemory).toBe("recent");
    expect(memory.recall).toHaveBeenCalledTimes(1);
  });

  it("uses the larger memory window for task-like conversation", async () => {
    const memory = { recall: vi.fn(async () => []) };
    const relationship = {
      get: vi.fn(async () => ({
        stage: "familiar" as const,
        userInitiative: 0.5,
      })),
    };
    const model = {
      generate: vi.fn(async () => "我来看看。"),
    };

    await respondToConversation(
      {
        ...baseRequest,
        userMessage: "帮我处理一下这个项目",
        signals: {
          ...baseRequest.signals,
          userMessage: "帮我处理一下这个项目",
          emotionalIntensity: 0.1,
          topicIsTaskLike: true,
        },
      },
      { memory, relationship, model },
    );

    expect(memory.recall).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        companionId: "companion-1",
        query: "帮我处理一下这个项目",
        limit: 8,
      }),
    );
  });
});
