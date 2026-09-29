import { describe, expect, it } from "vitest";
import { decideMemoryWrite } from "./write-policy";

describe("memory write policy", () => {
  it("stores explicit save requests at maximum importance", () => {
    expect(decideMemoryWrite({
      userMessage: "请记住我喜欢短回复",
      explicitSaveRequest: true,
      containsStablePreference: true,
    })).toEqual({
      action: "store",
      kind: "fact",
      importance: 1,
      reason: "explicit_request",
    });
  });

  it("stores durable decisions and preferences", () => {
    expect(decideMemoryWrite({
      userMessage: "以后这个项目都用 TypeScript",
      containsDecision: true,
    }).action).toBe("store");

    expect(decideMemoryWrite({
      userMessage: "我一直喜欢短一点的回复",
      containsStablePreference: true,
    }).kind).toBe("store");
  });

  it("stores high-significance emotional context", () => {
    expect(decideMemoryWrite({
      userMessage: "这件事对我真的很重要",
      emotionalSignificance: 0.9,
    }).kind).toBe("store");
  });

  it("does not turn ordinary conversation into permanent memory", () => {
    expect(decideMemoryWrite({
      userMessage: "哈哈今天吃了饭",
    })).toEqual({
      action: "skip",
      reason: "insufficient_long_term_value",
    });
  });

  it("rejects empty or oversized candidates", () => {
    expect(decideMemoryWrite({ userMessage: " " }).action).toBe("skip");
    expect(decideMemoryWrite({ userMessage: "x".repeat(2001) }).action).toBe("skip");
  });
});
