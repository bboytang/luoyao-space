import { describe, expect, it, vi } from "vitest";
import { respondToConversation } from "./conversation-service";

describe("conversation service", () => {
  it("loads relationship before directing and retrieves memory according to policy", async () => {
    const order: string[] = [];

    const memory = {
      recall: vi.fn(async () => {
        order.push("memory");
        return [{ id: "m1", content: "shared history", relevance: 0.9 }];
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
        expect(request.policy.action).toBe("react");
        return "好呀。";
      }),
    };

    const events = {
      emit: vi.fn(async () => {
        order.push("event");
      }),
    };

    const response = await respondToConversation(
      {
        userId: "user-1",
        companionId: "companion-1",
        sessionId: "session-1",
        userMessage: "今天还行",
        signals: {
          userMessage: "今天还行",
          recentQuestionCount: 0,
          recentAdviceCount: 0,
          emotionalIntensity: 0.2,
          topicIsTaskLike: false,
        },
      },
      { memory, relationship, model, events },
    );

    expect(response.text).toBe("好呀。");
    expect(order.slice(0, 3)).toEqual(["relationship", "memory", "model"]);
    expect(events.emit).toHaveBeenCalledTimes(2);
  });

  it("does not retrieve memory when the director explicitly disables it", async () => {
    const memory = { recall: vi.fn(async () => []) };
    const relationship = {
      get: vi.fn(async () => ({ stage: "new" as const, userInitiative: 0 }),
    };
    const model = {
      generate: vi.fn(async () => "嗯。"),
    };

    const response = await respondToConversation(
      {
        userId: "user-1",
        companionId: "companion-1",
        userMessage: "嗯",
        signals: {
          userMessage: "嗯",
          recentQuestionCount: 0,
          recentAdviceCount: 0,
          emotionalIntensity: 0,
          topicIsTaskLike: false,
        },
      },
      { memory, relationship, model },
    );

    expect(response.policy.useMemory).toBe("recent");
    expect(memory.recall).toHaveBeenCalledTimes(1);
  });

  it("uses the larger memory window for explicit memory-driven tasks", async () => {
    const memory = { retrieve: vi.fn(async () => []) };
    const relationship = {
      get: vi.fn(async () => ({ stage: "familiar" as const, userInitiative: 0.5 }),
    };
    const model = { generate: vi.fn(async () => "我来看看。") };

    await respondToConversation(
      {
        userId: "user-1",
        companionId: "companion-1",
        userMessage: "帮我处理一下这个项目",
        signals: {
          userMessage: "帮我处理一下这个项目",
          recentQuestionCount: 0,
          recentAdviceCount: 0,
          emotionalIntensity: 0.1,
          topicIsTaskLike: true,
        },
      },
      { memory, relationship, model },
    );

    expect(memory.recall).toHaveBeenCalledWith({
      userId: "user-1",
      companionId: "companion-1",
      query: "帮我处理一下这个项目",
      limit: 8,
    });
  });
});
