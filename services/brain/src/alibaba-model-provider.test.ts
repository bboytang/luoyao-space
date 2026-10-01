import { describe, expect, it, vi } from "vitest";
import { AlibabaBrainModelProvider } from "./alibaba-model-provider";

const turn = { transcript: "你好", responseLength: "very_short" as const, responseTone: "calm" as const,
  instructions: "APPROVED_LUOYAO_INSTRUCTIONS", memories: ["PRIVATE_MEMORY"], userId: "PRIVATE_USER" };

describe("AlibabaBrainModelProvider", () => {
  it("sends only Brain-approved instructions and transcript to Qwen Chat Completions", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "chatcmpl-1", object: "chat.completion",
      created: 1, model: "qwen-flash", choices: [{ index: 0, finish_reason: "stop", logprobs: null,
        message: { role: "assistant", content: "你好，我是洛瑶。" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
    { status: 200, headers: { "content-type": "application/json" } }));
    const provider = new AlibabaBrainModelProvider({ apiKey: "test-key", model: "qwen-flash",
      baseUrl: "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", fetch: fetchImpl as typeof fetch });
    await expect(provider.generate({ modelClass: "fast_chat", input: turn })).resolves.toEqual({
      text: "你好，我是洛瑶。", providerId: "alibaba-brain", modelId: "qwen-flash",
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions");
    expect(init.headers).toEqual({ authorization: "Bearer test-key", "content-type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ model: "qwen-flash", messages: [
      { role: "system", content: "APPROVED_LUOYAO_INSTRUCTIONS" }, { role: "user", content: "你好" },
    ] });
    expect(String(init.body)).not.toMatch(/PRIVATE_MEMORY|PRIVATE_USER|userId|deviceId|sessionId/);
  });

  it("fails with sanitized errors for upstream failures and malformed output", async () => {
    const failed = new AlibabaBrainModelProvider({ apiKey: "key", model: "qwen-flash",
      baseUrl: "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      fetch: vi.fn(async () => new Response("Bearer private-secret https://secret.test", { status: 503 })) as typeof fetch });
    await expect(failed.generate({ modelClass: "fast_chat", input: turn })).rejects.toThrow("Alibaba Brain model failed with HTTP 503");
    const empty = new AlibabaBrainModelProvider({ apiKey: "key", model: "qwen-flash",
      baseUrl: "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      fetch: vi.fn(async () => new Response(JSON.stringify({ choices: [] }))) as typeof fetch });
    await expect(empty.generate({ modelClass: "fast_chat", input: turn })).rejects.toThrow(/empty output/i);
  });
});
