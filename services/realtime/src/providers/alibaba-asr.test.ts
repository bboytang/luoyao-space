import { describe, expect, it } from "vitest";
import type { AudioStreamContext } from "../../../../runtimes/realtime-device/src/audio-pipeline";
import type { AudioFrame } from "../../../../runtimes/realtime-device/src/protocol";
import { AlibabaParaformerAsrProvider, type AlibabaAsrSocket } from "./alibaba-asr";

class FakeSocket implements AlibabaAsrSocket {
  readonly sent: Array<string | Uint8Array> = [];
  closed = false;
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  send(data: string | Uint8Array): void { this.sent.push(data); }
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
}

const frame: AudioFrame = { kind: "audio", codec: "pcm_s16le", sampleRate: 24_000,
  channels: 1, sequence: 0, payload: new Uint8Array([1, 0, 2, 0]) };
const context = (signal = new AbortController().signal): AudioStreamContext => ({
  sessionId: "PRIVATE_SESSION", conversationId: "PRIVATE_CONVERSATION",
  trustedIdentity: { userId: "PRIVATE_USER", authorizedDeviceId: "PRIVATE_DEVICE" }, signal,
});

describe("AlibabaParaformerAsrProvider", () => {
  it("executes the inference task lifecycle and exposes one aggregated final transcript", async () => {
    const socket = new FakeSocket();
    const provider = new AlibabaParaformerAsrProvider({ apiKey: "test-key", model: "paraformer-realtime-v2",
      url: "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference", createTaskId: () => "task-1",
      socketFactory: { create(url, options) {
        expect(url).toBe("wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference");
        expect(options.headers).toEqual({ Authorization: "Bearer test-key" });
        return socket;
      } } });
    const iterator = provider.transcribe((async function* () { yield frame; })(), context())[Symbol.asyncIterator]();
    const first = iterator.next();
    socket.emit("open", {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(JSON.parse(socket.sent[0] as string)).toEqual({
      header: { action: "run-task", task_id: "task-1", streaming: "duplex" },
      payload: { task_group: "audio", task: "asr", function: "recognition", model: "paraformer-realtime-v2",
        parameters: { format: "pcm", sample_rate: 24_000 }, input: {} },
    });
    socket.message({ header: { task_id: "task-1", event: "task-started", attributes: {} }, payload: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(socket.sent[1]).toEqual(frame.payload);
    socket.message({ header: { task_id: "task-1", event: "result-generated", attributes: {} },
      payload: { output: { sentence: { text: "你好", heartbeat: false, sentence_end: false } }, usage: null } });
    await expect(first).resolves.toEqual({ value: { type: "partial", text: "你好" }, done: false });
    const final = iterator.next();
    socket.message({ header: { task_id: "task-1", event: "result-generated", attributes: {} },
      payload: { output: { sentence: { text: "你好。", heartbeat: false, sentence_end: true } }, usage: { duration: 1 } } });
    socket.message({ header: { task_id: "task-1", event: "result-generated", attributes: {} },
      payload: { output: { sentence: { text: "朋友。", heartbeat: false, sentence_end: true } }, usage: { duration: 2 } } });
    socket.message({ header: { task_id: "task-1", event: "task-finished", attributes: {} }, payload: {} });
    await expect(final).resolves.toEqual({ value: { type: "final", text: "你好。朋友。" }, done: false });
    expect(JSON.parse(socket.sent.at(-1) as string)).toEqual({
      header: { action: "finish-task", task_id: "task-1", streaming: "duplex" }, payload: { input: {} },
    });
    expect(socket.sent.filter((item): item is string => typeof item === "string").join(" "))
      .not.toMatch(/PRIVATE_USER|PRIVATE_DEVICE|PRIVATE_SESSION|PRIVATE_CONVERSATION/);
  });

  it("fails closed on invalid audio, cancellation and provider errors without exposing provider details", async () => {
    const factory = { create: () => new FakeSocket() };
    expect(() => new AlibabaParaformerAsrProvider({ apiKey: "", model: "paraformer-realtime-v2",
      url: "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference", socketFactory: factory })).toThrow(/key/i);
    const badSocket = new FakeSocket();
    const bad = new AlibabaParaformerAsrProvider({ apiKey: "key", model: "paraformer-realtime-v2",
      url: "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference", socketFactory: { create: () => badSocket } });
    const badResult = bad.transcribe((async function* () { yield { ...frame, sampleRate: 16_000 }; })(), context())[Symbol.asyncIterator]().next();
    badSocket.emit("open", {}); badSocket.message({ header: { event: "task-started" }, payload: {} });
    await expect(badResult).rejects.toThrow(/24.?000/);

    const errorSocket = new FakeSocket();
    const errorProvider = new AlibabaParaformerAsrProvider({ apiKey: "key", model: "paraformer-realtime-v2",
      url: "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference", socketFactory: { create: () => errorSocket } });
    const errorResult = errorProvider.transcribe((async function* () {})(), context())[Symbol.asyncIterator]().next();
    errorSocket.emit("open", {});
    errorSocket.message({ header: { event: "task-failed", error_code: "SecretCode", error_message: "Bearer private-secret https://secret.test" }, payload: {} });
    await expect(errorResult).rejects.toThrow("Alibaba ASR task failed");

    const abortSocket = new FakeSocket(); const controller = new AbortController();
    const abortProvider = new AlibabaParaformerAsrProvider({ apiKey: "key", model: "paraformer-realtime-v2",
      url: "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference", socketFactory: { create: () => abortSocket } });
    const aborted = abortProvider.transcribe((async function* () {})(), context(controller.signal))[Symbol.asyncIterator]().next();
    controller.abort();
    await expect(aborted).resolves.toMatchObject({ done: true });
    expect(abortSocket.closed).toBe(true);
  });
});
