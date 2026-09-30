import { describe, expect, it } from "vitest";
import type { AudioFrame } from "../../../../runtimes/realtime-device/src/protocol";
import type { AudioStreamContext } from "../../../../runtimes/realtime-device/src/audio-pipeline";
import {
  OpenAiAsrProvider,
  type OpenAiAsrSocket,
  type OpenAiAsrSocketFactory,
} from "./openai-asr";

class FakeSocket implements OpenAiAsrSocket {
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.emit("close", {});
  }

  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: "open" | "message" | "error" | "close", listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: "open" | "message" | "error" | "close", event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const frame: AudioFrame = {
  kind: "audio",
  codec: "pcm_s16le",
  sampleRate: 24000,
  channels: 1,
  sequence: 0,
  payload: new Uint8Array([1, 2, 3, 4]),
};

const context = (): AudioStreamContext => ({
  sessionId: "session-1",
  conversationId: "conversation-1",
  signal: new AbortController().signal,
});

describe("OpenAiAsrProvider", () => {
  it("opens an authenticated realtime transcription session and streams transcript events", async () => {
    const socket = new FakeSocket();
    const factory: OpenAiAsrSocketFactory = {
      create: (url, options) => {
        expect(url).toBe("wss://example.test/realtime");
        expect(options.headers.Authorization).toBe("Bearer test-key");
        return socket;
      },
    };

    const provider = new OpenAiAsrProvider({
      apiKey: "test-key",
      model: "gpt-live-transcribe",
      url: "wss://example.test/realtime",
      socketFactory: factory,
    });

    const frames = (async function* () {
      yield frame;
    })();

    const iterator = provider.transcribe(frames, context())[Symbol.asyncIterator]();
    const first = iterator.next();

    socket.emit("open", {});
    await first;

    const sessionUpdate = JSON.parse(socket.sent[0]);
    expect(sessionUpdate).toEqual({
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: { model: "gpt-live-transcribe" },
            turn_detection: null,
          },
        },
      },
    });

    const second = await iterator.next();
    expect(second.value).toEqual({ type: "partial", text: "你好" });
    expect(JSON.parse(socket.sent[1])).toEqual({
      type: "input_audio_buffer.append",
      audio: "AQIDBA==",
    });

    socket.emit("message", {
      data: JSON.stringify({
        type: "conversation.item.input_audio_transcription.delta",
        delta: "你好",
      }),
    });
    const third = await iterator.next();
    expect(third.value).toEqual({ type: "partial", text: "你好" });

    socket.emit("message", {
      data: JSON.stringify({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "你好，朋友。",
      }),
    });
    socket.emit("close", {});

    const fourth = await iterator.next();
    expect(fourth.value).toEqual({ type: "final", text: "你好，朋友。" });
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: "input_audio_buffer.commit",
    });
  });

  it("rejects non-PCM or non-mono frames", async () => {
    const socket = new FakeSocket();
    const provider = new OpenAiAsrProvider({
      apiKey: "test-key",
      model: "gpt-live-transcribe",
      socketFactory: { create: () => socket },
    });

    socket.emit("open", {});
    const badFrame = { ...frame, codec: "opus" as const };

    const iterator = provider.transcribe(
      (async function* () {
        yield badFrame;
      })(),
      context(),
    )[Symbol.asyncIterator]();

    socket.emit("open", {});
    await expect(iterator.next()).rejects.toThrow("requires PCM16 audio");
  });

  it("requires credentials and a model", () => {
    const factory: OpenAiAsrSocketFactory = { create: () => new FakeSocket() };

    expect(() => new OpenAiAsrProvider({
      apiKey: "",
      model: "gpt-live-transcribe",
      socketFactory: factory,
    })).toThrow("OpenAI API key is required");

    expect(() => new OpenAiAsrProvider({
      apiKey: "test-key",
      model: "",
      socketFactory: factory,
    })).toThrow("OpenAI ASR model is required");
  });
});
