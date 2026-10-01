import { describe, expect, it, vi } from "vitest";
import { MemoryIsolatedVoiceModel } from "./voice-model-boundary";
import type { ModelRouter } from "./model-router";
import type { ConversationModelRequest } from "./conversation-service";
import { respondToConversation } from "./conversation-service";
import { DefaultModelRouter } from "./model-router";
import { OpenAiBrainModelProvider } from "./openai-model-provider";

const request: ConversationModelRequest = {
  userMessage: "你好",
  policy: { action: "listen", responseLength: "very_short", emotion: "calm", emotionIntensity: 0.3,
    useMemory: "recent", selfDisclosure: 0.15, questionProbability: 0.22, relationshipExpression: 0.08,
    adviceProbability: 0.04, teasingProbability: 0.06 },
  memories: [{ id: "private-id", content: "PRIVATE_LONG_TERM_MEMORY_SENTINEL", relevance: 0.9 }],
  relationship: { stage: "close", userInitiative: 0.9 },
};

describe("MemoryIsolatedVoiceModel", () => {
  it("constructs an allowlisted provider input before any model provider receives it", async () => {
    const generate = vi.fn(async () => ({ text: "你好。", providerId: "fake" }));
    const router = { generate } as unknown as ModelRouter;
    const model = new MemoryIsolatedVoiceModel(router);
    expect(await model.generate(request)).toBe("你好。");
    expect(generate).toHaveBeenCalledWith({ modelClass: "fast_chat", input: {
      transcript: "你好", responseLength: "very_short", responseTone: "calm",
    } });
    expect(JSON.stringify(generate.mock.calls[0])).not.toContain("PRIVATE_LONG_TERM_MEMORY_SENTINEL");
  });
  it("passes cancellation without including the signal in external model context", async () => {
    const generate = vi.fn(async () => ({ text: "你好。", providerId: "fake" }));
    const signal = new AbortController().signal;
    const model = new MemoryIsolatedVoiceModel({ generate } as unknown as ModelRouter);
    await model.generate({ ...request, signal });
    expect(generate).toHaveBeenCalledWith({ modelClass: "fast_chat", signal, input: {
      transcript: "你好", responseLength: "very_short", responseTone: "calm",
    } });
    expect(JSON.stringify(generate.mock.calls[0])).not.toContain("PRIVATE_LONG_TERM_MEMORY_SENTINEL");
  });
  it("keeps a genuinely retrieved long-term memory out of the external HTTP request", async () => {
    let outboundBody = "";
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      outboundBody = String(init?.body);
      return new Response(JSON.stringify({ status: "completed", output: [
        { type: "message", content: [{ type: "output_text", text: "你好。" }] },
      ] }), { status: 200 });
    });
    const model = new MemoryIsolatedVoiceModel(new DefaultModelRouter([
      new OpenAiBrainModelProvider({ apiKey: "test-key", model: "test-model", fetch: fetchImpl as typeof fetch }),
    ], { fast_chat: "openai-brain" }));
    const memory = { recall: vi.fn(async () => [{ id: "private-id", content: "PRIVATE_LONG_TERM_MEMORY_SENTINEL", score: 0.9 }]) };
    const result = await respondToConversation({
      userId: "trusted-user", companionId: "luoyao", userMessage: "你好",
      signals: { userMessage: "你好", recentQuestionCount: 0, recentAdviceCount: 0,
        emotionalIntensity: 0, topicIsTaskLike: false },
    }, { memory: memory as never, relationship: { async get() { return { stage: "new", userInitiative: 0 }; } }, model });
    expect(result.memories[0]?.content).toBe("PRIVATE_LONG_TERM_MEMORY_SENTINEL");
    expect(result.text).toBe("你好。");
    expect(outboundBody).toContain("你好");
    expect(outboundBody).not.toMatch(/PRIVATE_LONG_TERM_MEMORY_SENTINEL|private-id|trusted-user|luoyao/);
  });
});
