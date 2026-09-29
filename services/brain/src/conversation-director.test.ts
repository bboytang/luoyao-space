import { describe, expect, it } from "vitest";
import { directConversation } from "./conversation-director";

describe("conversation director", () => {
  it("keeps casual short messages short", () => {
    const policy = directConversation({
      userMessage: "吃饭了吗",
      recentQuestionCount: 0,
      recentAdviceCount: 0,
      relationshipStage: "familiar",
      userInitiative: 0.5,
      emotionalIntensity: 0.1,
      topicIsTaskLike: false,
    });

    expect(policy.responseLength).toBe("very_short");
    expect(policy.adviceProbability).toBeLessThan(0.1);
  });

  it("allows playful banter without forcing care-taking", () => {
    const policy = directConversation({
      userMessage: "我今天帅得有点过分了",
      recentQuestionCount: 1,
      recentAdviceCount: 0,
      relationshipStage: "close",
      userInitiative: 0.8,
      emotionalIntensity: 0.2,
      topicIsTaskLike: false,
    });

    expect(policy.action).toBe("tease");
    expect(policy.teasingProbability).toBeGreaterThan(0.4);
  });

  it("switches to solution behavior for tasks", () => {
    const policy = directConversation({
      userMessage: "帮我把这个项目拆成任务",
      recentQuestionCount: 0,
      recentAdviceCount: 0,
      relationshipStage: "close",
      userInitiative: 0.7,
      emotionalIntensity: 0.2,
      topicIsTaskLike: true,
    });

    expect(policy.action).toBe("solve");
    expect(policy.adviceProbability).toBeGreaterThan(0.5);
  });
});
