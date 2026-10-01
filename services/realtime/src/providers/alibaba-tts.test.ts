import { describe, expect, it } from "vitest";
import type { AudioStreamContext } from "../../../../runtimes/realtime-device/src/audio-pipeline";
import { AlibabaCosyVoiceTtsProvider, type AlibabaTtsSocket } from "./alibaba-tts";

class FakeSocket implements AlibabaTtsSocket {
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  send(data: string): void { this.sent.push(data); }
  close(): void { this.closed = true; this.emit("close", {}); }
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set(); listeners.add(listener); this.listeners.set(type, listeners);
  }
  removeEventListener(type: "open" | "message" | "error" | "close", listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: "open" | "message" | "error" | "close", event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  message(body: unknown): void { this.emit("message", { data: JSON.stringify(body) }); }
  binary(bytes: number[]): void { this.emit("message", { data: new Uint8Array(bytes) }); }
}
const context = (signal = new AbortController().signal): AudioStreamContext => ({
  sessionId: "PRIVATE_SESSION", conversationId: "PRIVATE_CONVERSATION",
  trustedIdentity: { userId: "PRIVATE_USER", authorizedDeviceId: "PRIVATE_DEVICE" }, signal,
});

describe("AlibabaCosyVoiceTtsProvider", () => {
  it("executes the inference task lifecycle and emits aligned 24 kHz mono PCM16", async () => {
    const socket = new FakeSocket();
    const provider = new AlibabaCosyVoiceTtsProvider({ apiKey: "test-key", model: "cosyvoice-v3.5-flash",
      voice: "voice-example", url: "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
      createTaskId: () => "task-1", socketFactory: { create(url, options) {
        expect(url).toBe("wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference");
        expect(options.headers).toEqual({ Authorization: "Bearer test-key" }); return socket;
      } } });
    const iterator = provider.synthesize({ messageId: "PRIVATE_MESSAGE", text: "你好" }, context())[Symbol.asyncIterator]();
    const started = iterator.next(); socket.emit("open", {}); await new Promise((resolve) => setTimeout(resolve, 0));
    expect(JSON.parse(socket.sent[0])).toEqual({
      header: { action: "run-task", task_id: "task-1", streaming: "duplex" },
      payload: { task_group: "audio", task: "tts", function: "SpeechSynthesizer", model: "cosyvoice-v3.5-flash",
        parameters: { text_type: "PlainText", voice: "voice-example", format: "pcm", sample_rate: 24_000 }, input: {} },
    });
    socket.message({ header: { task_id: "task-1", event: "task-started", attributes: {} }, payload: {} });
    await expect(started).resolves.toEqual({ value: { type: "started" }, done: false });
    expect(JSON.parse(socket.sent[1])).toEqual({ header: { action: "continue-task", task_id: "task-1", streaming: "duplex" },
      payload: { input: { text: "你好" } } });
    expect(JSON.parse(socket.sent[2])).toEqual({ header: { action: "finish-task", task_id: "task-1", streaming: "duplex" },
      payload: { input: {} } });
    const audio = iterator.next();
    socket.message({ header: { task_id: "task-1", event: "result-generated", attributes: {} },
      payload: { output: { type: "sentence-synthesis", sentence: { index: 0, words: [] } } } });
    socket.binary([1, 0, 2]); socket.binary([0]);
    await expect(audio).resolves.toEqual({ value: { type: "audio", frame: { kind: "audio", codec: "pcm_s16le",
      sampleRate: 24_000, channels: 1, sequence: 0, payload: new Uint8Array([1, 0]) } }, done: false });
    const secondAudio = iterator.next();
    await expect(secondAudio).resolves.toEqual({ value: { type: "audio", frame: { kind: "audio", codec: "pcm_s16le",
      sampleRate: 24_000, channels: 1, sequence: 1, payload: new Uint8Array([2, 0]) } }, done: false });
    const completed = iterator.next();
    socket.message({ header: { task_id: "task-1", event: "task-finished", attributes: {} }, payload: { usage: { characters: 2 } } });
    await expect(completed).resolves.toEqual({ value: { type: "completed" }, done: false });
    expect(socket.sent.join(" ")).not.toMatch(/PRIVATE_USER|PRIVATE_DEVICE|PRIVATE_SESSION|PRIVATE_CONVERSATION|PRIVATE_MESSAGE/);
  });

  it("requires an explicit voice and sanitizes cancellation and provider errors", async () => {
    const factory = { create: () => new FakeSocket() };
    expect(() => new AlibabaCosyVoiceTtsProvider({ apiKey: "key", model: "cosyvoice-v3.5-flash", voice: "",
      url: "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference", socketFactory: factory })).toThrow(/voice/i);
    const errorSocket = new FakeSocket();
    const failed = new AlibabaCosyVoiceTtsProvider({ apiKey: "key", model: "cosyvoice-v3.5-flash", voice: "voice",
      url: "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference", socketFactory: { create: () => errorSocket } });
    const failure = failed.synthesize({ messageId: "m", text: "你好" }, context())[Symbol.asyncIterator]().next();
    errorSocket.emit("open", {}); errorSocket.message({ header: { event: "task-failed", error_code: "SecretCode",
      error_message: "Bearer private-secret https://secret.test" }, payload: {} });
    await expect(failure).rejects.toThrow("Alibaba TTS task failed");

    const abortSocket = new FakeSocket(); const controller = new AbortController();
    const cancelled = new AlibabaCosyVoiceTtsProvider({ apiKey: "key", model: "cosyvoice-v3.5-flash", voice: "voice",
      url: "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference", createTaskId: () => "task-cancel",
      socketFactory: { create: () => abortSocket } });
    const result = cancelled.synthesize({ messageId: "m", text: "你好" }, context(controller.signal))[Symbol.asyncIterator]().next();
    abortSocket.emit("open", {}); abortSocket.message({ header: { event: "task-started" }, payload: {} });
    await result; controller.abort(); await new Promise((resolve) => setTimeout(resolve, 0));
    expect(JSON.parse(abortSocket.sent.at(-1)!)).toEqual({
      header: { action: "finish-task", task_id: "task-cancel", streaming: "duplex" }, payload: { input: { directive: "cancel" } },
    });
    expect(abortSocket.closed).toBe(true);
  });
});
