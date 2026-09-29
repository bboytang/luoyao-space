import { describe, expect, it, vi } from "vitest";
import { consumeMemoryWriteRequested } from "./event-consumer";

describe("memory write event consumer", () => {
  it("forwards a write request into MemoryService", async () => {
    const rememberCandidate = vi.fn(async () => ({
      action: "store" as const,
      reason: "stable_preference",
      memory: { id: "m1" },
    }));

    const result = await consumeMemoryWriteRequested({
      type: "memory.write.requested",
      userId: "u1",
      companionId: "c1",
      data: { userMessage: "我喜欢无糖茶", signals: { containsStablePreference: true } },
    }, { rememberCandidate });

    expect(result.action).toBe("store");
    expect(rememberCandidate).toHaveBeenCalledWith({
      userId: "u1",
      companionId: "c1",
      userMessage: "我喜欢无糖茶",
      containsStablePreference: true,
    });
  });

  it("rejects empty write requests before touching MemoryService", async () => {
    const rememberCandidate = vi.fn();

    await expect(consumeMemoryWriteRequested({
      type: "memory.write.requested",
      userId: "u1",
      companionId: "c1",
      data: { userMessage: "   ", signals: {} },
    }, { rememberCandidate })).rejects.toThrow("userMessage must not be empty");

    expect(rememberCandidate).not.toHaveBeenCalled();
  });
});