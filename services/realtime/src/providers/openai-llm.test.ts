import { describe, expect, it } from "vitest";
import { OpenAiLlmProvider } from "./openai-llm";

function context(signal: AbortSignal) {
  return {
    sessionId: "s1",
    conversationId: "c1",
    signal,
  };
}

function sse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe("OpenAiLlmProvider", () => {
  it("maps streamed OpenAI deltas and sentence boundaries", async () => {
    let request: Request | undefined;
    const provider = new OpenAiLlmProvider({
      apiKey: "test-key",
      model: "test-model",
      baseUrl: "https://example.test/v1",
      fetch: async (input, init) => {
        request = new Request(input, init);
        return sse([
          'data: {"type":"response.output_text.delta","delta":"你好"}\n\n',
          'data: {"type":"response.output_text.delta","delta":"，朋友。"}\n\n',
          'data: {"type":"response.output_text.delta","delta":"再见"}\n\n',
          'data: {"type":"response.completed"}\n\n',
        ]);
      },
    });

    const events = [];
    for await (const event of provider.stream(
      { text: "你好", conversationId: "c1" },
      context(new AbortController().signal),
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", text: "你好" },
      { type: "text_delta", text: "，朋友。" },
      { type: "sentence", text: "你好，朋友。" },
      { type: "text_delta", text: "再见" },
      { type: "sentence", text: "再见" },
      { type: "done", finishReason: "stop" },
    ]);
    expect(request?.url).toBe("https://example.test/v1/responses");
    expect(request?.headers.get("authorization")).toBe("Bearer test-key");
    expect(await request?.json()).toEqual({
      model: "test-model",
      input: "你好",
      stream: true,
    });
  });

  it("surfaces API errors without leaking the authorization header", async () => {
    const provider = new OpenAiLlmProvider({
      apiKey: "secret",
      model: "test-model",
      fetch: async () => new Response("bad request", { status: 400 }),
    });

    await expect(async () => {
      for await (const _ of provider.stream(
        { text: "hi", conversationId: "c1" },
        context(new AbortController().signal),
      )) {
        // consume
      }
    }).rejects.toThrow("OpenAI Responses API failed (400): bad request");
  });
});
