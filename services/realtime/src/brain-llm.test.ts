import { describe, expect, it, vi } from "vitest";
import { BrainLlmProvider } from "./brain-llm";
import type { AudioStreamContext } from "../../../runtimes/realtime-device/src/audio-pipeline";
import { MemoryIsolatedVoiceModel } from "../../brain/src/voice-model-boundary";
import type { ModelRouter } from "../../brain/src/model-router";

const context = (trustedIdentity?: { userId: string; authorizedDeviceId: string }): AudioStreamContext => ({
  sessionId: "server-transport", conversationId: "server-conversation", trustedIdentity,
  signal: new AbortController().signal,
});

describe("BrainLlmProvider", () => {
  it("routes admitted identity through Brain and returns its generated response", async () => {
    const memory = { recall: vi.fn(async () => []) };
    const relationship = { get: vi.fn(async () => ({ stage: "new" as const, userInitiative: 0 })) };
    const generate = vi.fn(async () => ({ text: "你好，我是洛瑶。", providerId: "fake" }));
    const model = new MemoryIsolatedVoiceModel({ generate } as unknown as ModelRouter);
    const provider = new BrainLlmProvider("luoyao", { memory, relationship, model });
    const events = [];
    for await (const event of provider.stream({ text: "你好", conversationId: "forged-conversation" },
      context({ userId: "trusted-user", authorizedDeviceId: "authorized-device" }))) events.push(event);
    expect(events).toEqual([{ type: "sentence", text: "你好，我是洛瑶。" }, { type: "done", finishReason: "stop" }]);
    expect(relationship.get).toHaveBeenCalledWith({ userId: "trusted-user", companionId: "luoyao" });
    expect(memory.recall).toHaveBeenCalledWith(expect.objectContaining({ userId: "trusted-user", companionId: "luoyao", query: "你好" }));
  });

  it("refuses an unauthenticated Brain turn before reading memory or generating", async () => {
    const memory = { recall: vi.fn(async () => []) };
    const relationship = { get: vi.fn(async () => ({ stage: "new" as const, userInitiative: 0 })) };
    const generate = vi.fn(async () => ({ text: "never", providerId: "fake" }));
    const model = new MemoryIsolatedVoiceModel({ generate } as unknown as ModelRouter);
    const provider = new BrainLlmProvider("luoyao", { memory, relationship, model });
    const consume = async () => { for await (const _event of provider.stream({ text: "hi", conversationId: "fake" }, context())) {} };
    await expect(consume()).rejects.toThrow(/trusted admitted identity/i);
    expect(relationship.get).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
});
