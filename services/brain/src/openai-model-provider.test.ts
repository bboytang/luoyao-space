import { describe, expect, it, vi } from "vitest";
import { OpenAiBrainModelProvider } from "./openai-model-provider";
import type { VoiceModelContext } from "./voice-model-boundary";

const turn: VoiceModelContext & Record<string, unknown> = {
  transcript: "你好", responseLength: "very_short", responseTone: "calm",
  memories: [{ id: "private-memory-id", content: "PRIVATE_LONG_TERM_MEMORY_SENTINEL", relevance: 0.8 }],
  relationship: { stage: "close", userInitiative: 0.7 },
};

describe("OpenAiBrainModelProvider privacy boundary", () => {
  it("sends only transcript and permitted response instructions, never retrieved memory or relationship identity", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      status: "completed", output: [
        { type: "reasoning", content: [] },
        { type: "message", content: [{ type: "output_text", text: "你好，" }] },
        { type: "message", content: [{ type: "output_text", text: "很高兴见到你。" }] },
      ],
    }), { status: 200 }));
    const provider = new OpenAiBrainModelProvider({ apiKey: "test-key", model: "test-model", fetch: fetchImpl as typeof fetch });
    const result = await provider.generate({ modelClass: "fast_chat", input: turn });
    expect(result.text).toBe("你好，很高兴见到你。");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: "test-model", input: "你好", store: false });
    expect(body.instructions).toContain("洛瑶");
    expect(body.instructions).toContain("简短");
    expect(String(init.body)).not.toMatch(/PRIVATE_LONG_TERM_MEMORY_SENTINEL|private-memory-id|close|userInitiative|userId|deviceId|sessionId/);
    expect(init.headers).toMatchObject({ authorization: "Bearer test-key" });
  });

  it("fails closed on upstream failure, empty output, invalid input and missing credentials", async () => {
    expect(() => new OpenAiBrainModelProvider({ apiKey: "", model: "m" })).toThrow(/key/i);
    const error = new OpenAiBrainModelProvider({ apiKey: "key", model: "m", fetch: vi.fn(async () => new Response("bad", { status: 503 })) as typeof fetch });
    await expect(error.generate({ modelClass: "fast_chat", input: turn })).rejects.toThrow(/503/);
    const empty = new OpenAiBrainModelProvider({ apiKey: "key", model: "m", fetch: vi.fn(async () => new Response(JSON.stringify({ status: "completed", output: [] }))) as typeof fetch });
    await expect(empty.generate({ modelClass: "fast_chat", input: turn })).rejects.toThrow(/empty/i);
    await expect(empty.generate({ modelClass: "fast_chat", input: {} })).rejects.toThrow(/Brain conversation/i);
  });
  it("bounds a stalled external model request with a provider timeout", async () => {
    const provider = new OpenAiBrainModelProvider({ apiKey: "key", model: "m", timeoutMs: 20,
      fetch: vi.fn(async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("fetch aborted")), { once: true });
      })) as typeof fetch });
    await expect(provider.generate({ modelClass: "fast_chat", input: turn })).rejects.toThrow(/timed out/i);
  });
});
