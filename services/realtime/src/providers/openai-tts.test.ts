import { describe, expect, it, vi } from "vitest";
import { OpenAiTtsProvider } from "./openai-tts";
import type { AudioStreamContext } from "../../../../runtimes/realtime-device/src/audio-pipeline";

const context = (signal = new AbortController().signal): AudioStreamContext => ({
  sessionId: "session-1", conversationId: "conversation-1", signal,
});

function response(...chunks: number[][]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "audio/pcm" } });
}

describe("OpenAiTtsProvider", () => {
  it("requests raw PCM and emits aligned 24 kHz mono speech across odd network chunks", async () => {
    const fetchImpl = vi.fn(async () => response([0, 0, 1], [0, 255, 127]));
    const provider = new OpenAiTtsProvider({
      apiKey: "test-key", model: "gpt-4o-mini-tts", voice: "alloy", fetch: fetchImpl as typeof fetch,
    });
    const frames = [];
    for await (const event of provider.synthesize({ messageId: "message-1", text: "你好" }, context())) {
      if (event.type === "audio") frames.push(event.frame);
    }
    expect(frames.map((frame) => Array.from(frame.payload))).toEqual([[0, 0], [1, 0, 255, 127]]);
    expect(frames.map((frame) => frame.sequence)).toEqual([0, 1]);
    expect(frames.every((frame) => frame.codec === "pcm_s16le" && frame.sampleRate === 24_000 && frame.channels === 1)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "gpt-4o-mini-tts", voice: "alloy", input: "你好", response_format: "pcm",
    });
    expect(init.headers).toMatchObject({ authorization: "Bearer test-key" });
  });

  it("fails rather than emitting a successful all-silent response", async () => {
    const provider = new OpenAiTtsProvider({
      apiKey: "test-key", model: "gpt-4o-mini-tts", voice: "alloy",
      fetch: vi.fn(async () => response([0, 0, 0, 0])) as typeof fetch,
    });
    const consume = async () => {
      for await (const _event of provider.synthesize({ messageId: "m", text: "hello" }, context())) { /* consume */ }
    };
    await expect(consume()).rejects.toThrow(/silent/i);
  });

  it("fails closed for truncated PCM and upstream provider errors", async () => {
    const malformed = new OpenAiTtsProvider({
      apiKey: "test-key", model: "gpt-4o-mini-tts", voice: "alloy",
      fetch: vi.fn(async () => response([1, 0, 2])) as typeof fetch,
    });
    const consume = async (provider: OpenAiTtsProvider) => {
      for await (const _event of provider.synthesize({ messageId: "m", text: "hello" }, context())) { /* consume */ }
    };
    await expect(consume(malformed)).rejects.toThrow(/incomplete|odd/i);
    const failed = new OpenAiTtsProvider({
      apiKey: "test-key", model: "gpt-4o-mini-tts", voice: "alloy",
      fetch: vi.fn(async () => new Response("provider error", { status: 503 })) as typeof fetch,
    });
    await expect(consume(failed)).rejects.toThrow(/503/);
  });

  it("rejects a response explicitly labeled as a different audio format", async () => {
    const provider = new OpenAiTtsProvider({ apiKey: "key", model: "m", voice: "alloy",
      fetch: vi.fn(async () => new Response(new Uint8Array([1, 0, 2, 0]),
        { headers: { "content-type": "audio/mpeg" } })) as typeof fetch });
    const consume = async () => { for await (const _event of provider.synthesize({ messageId: "m", text: "hi" }, context())) {} };
    await expect(consume()).rejects.toThrow(/format|content.type/i);
  });

  it("requires explicit credentials and respects cancellation", async () => {
    expect(() => new OpenAiTtsProvider({ apiKey: "", model: "m", voice: "alloy" })).toThrow(/key/i);
    const abort = new AbortController();
    abort.abort();
    const fetchImpl = vi.fn(async () => response([1, 0]));
    const provider = new OpenAiTtsProvider({
      apiKey: "test-key", model: "gpt-4o-mini-tts", voice: "alloy", fetch: fetchImpl as typeof fetch,
    });
    const consume = async () => {
      for await (const _event of provider.synthesize({ messageId: "m", text: "hello" }, context(abort.signal))) { /* consume */ }
    };
    await expect(consume()).rejects.toThrow(/abort/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("bounds a stalled speech synthesis request with a provider timeout", async () => {
    const provider = new OpenAiTtsProvider({ apiKey: "key", model: "m", voice: "alloy", timeoutMs: 20,
      fetch: vi.fn(async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("fetch aborted")), { once: true });
      })) as typeof fetch });
    const consume = async () => { for await (const _event of provider.synthesize({ messageId: "m", text: "hi" }, context())) {} };
    await expect(consume()).rejects.toThrow(/timed out/i);
  });
  it("bounds an opened but stalled PCM response stream", async () => {
    const body = new ReadableStream<Uint8Array>({ start() {} });
    const provider = new OpenAiTtsProvider({ apiKey: "key", model: "m", voice: "alloy", timeoutMs: 20,
      fetch: vi.fn(async () => new Response(body, { headers: { "content-type": "audio/pcm" } })) as typeof fetch });
    const consume = async () => { for await (const _event of provider.synthesize({ messageId: "m", text: "hi" }, context())) {} };
    await expect(consume()).rejects.toThrow(/timed out/i);
  });
});
