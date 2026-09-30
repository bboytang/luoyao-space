import { describe, expect, it } from "vitest";
import { createDemoRealtimePipeline } from "./demo-pipeline";

const frame = {
  kind: "audio" as const,
  codec: "pcm_s16le" as const,
  sampleRate: 24_000,
  channels: 1,
  sequence: 0,
  payload: new Uint8Array([1, 2, 3, 4]),
};

describe("createDemoRealtimePipeline", () => {
  it("provides deterministic ASR, LLM and PCM TTS behavior", async () => {
    const pipeline = createDemoRealtimePipeline();
    const context = {
      sessionId: "demo-session",
      conversationId: "demo-conversation",
      signal: new AbortController().signal,
    };

    const asr = [];
    for await (const event of pipeline.asr.transcribe((async function* () { yield frame; })(), context)) {
      asr.push(event);
    }

    const llm = [];
    for await (const event of pipeline.llm.stream({ text: "你好", conversationId: context.conversationId }, context)) {
      llm.push(event);
    }

    const tts = [];
    for await (const event of pipeline.tts.synthesize({ messageId: "message-1", text: "你好，我在这里。" }, context)) {
      tts.push(event);
    }

    expect(asr).toEqual([
      { type: "partial", text: "你好" },
      { type: "final", text: "你好" },
    ]);
    expect(llm).toEqual([
      { type: "text_delta", text: "你好，我在这里。" },
      { type: "sentence", text: "你好，我在这里。" },
      { type: "done", finishReason: "stop" },
    ]);
    expect(tts[1]).toEqual({ type: "audio", frame });
  });
});
