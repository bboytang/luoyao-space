import type { AsrEvent, AsrProvider, AudioStreamContext } from "../../../../runtimes/realtime-device/src/audio-pipeline";
import type { AudioFrame } from "../../../../runtimes/realtime-device/src/protocol";

export interface AlibabaAsrSocket {
  send(data: string | Uint8Array): void;
  close(): void;
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: unknown) => void): void;
  removeEventListener(type: "open" | "message" | "error" | "close", listener: (event: unknown) => void): void;
}

export interface AlibabaAsrOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly url: string;
  readonly timeoutMs?: number;
  readonly createTaskId?: () => string;
  readonly socketFactory: { create(url: string, options: { readonly headers: Record<string, string> }): AlibabaAsrSocket };
}

interface InferenceEvent {
  readonly header?: { readonly task_id?: string; readonly event?: string };
  readonly payload?: { readonly output?: { readonly sentence?: {
    readonly text?: string; readonly heartbeat?: boolean; readonly sentence_end?: boolean;
  } } };
}

function messageText(event: unknown): string | undefined {
  return event && typeof event === "object" && "data" in event &&
    typeof (event as { data?: unknown }).data === "string" ? (event as { data: string }).data : undefined;
}

function validateFrame(frame: AudioFrame): void {
  if (frame.codec !== "pcm_s16le" || frame.channels !== 1 || frame.sampleRate !== 24_000 || frame.payload.length % 2 !== 0) {
    throw new Error("Alibaba ASR requires aligned 24,000 Hz mono PCM16 audio");
  }
}

export class AlibabaParaformerAsrProvider implements AsrProvider {
  constructor(private readonly options: AlibabaAsrOptions) {
    if (!options.apiKey.trim()) throw new Error("Alibaba ASR API key is required");
    if (options.model !== "paraformer-realtime-v2") throw new Error("Alibaba ASR model must be paraformer-realtime-v2");
    if (!options.url.trim()) throw new Error("Alibaba ASR WebSocket URL is required");
    if (!Number.isInteger(options.timeoutMs ?? 120_000) || (options.timeoutMs ?? 120_000) <= 0) {
      throw new Error("Alibaba ASR timeout must be a positive integer");
    }
  }

  async *transcribe(frames: AsyncIterable<AudioFrame>, context: AudioStreamContext): AsyncIterable<AsrEvent> {
    const taskId = (this.options.createTaskId ?? (() => crypto.randomUUID()))();
    const socket = this.options.socketFactory.create(this.options.url,
      { headers: { Authorization: `Bearer ${this.options.apiKey}` } });
    const queue: InferenceEvent[] = [];
    let wake: (() => void) | undefined;
    let opened = false;
    let closed = false;
    let failure: Error | undefined;
    const notify = () => { const current = wake; wake = undefined; current?.(); };
    const onOpen = () => {
      opened = true;
      socket.send(JSON.stringify({
        header: { action: "run-task", task_id: taskId, streaming: "duplex" },
        payload: { task_group: "audio", task: "asr", function: "recognition", model: this.options.model,
          parameters: { format: "pcm", sample_rate: 24_000 }, input: {} },
      }));
      notify();
    };
    const onMessage = (event: unknown) => {
      const data = messageText(event);
      if (data === undefined) return;
      try { queue.push(JSON.parse(data) as InferenceEvent); }
      catch { failure = new Error("Alibaba ASR returned invalid JSON"); }
      notify();
    };
    const onError = () => { failure = new Error("Alibaba ASR WebSocket error"); notify(); };
    const onClose = () => { closed = true; notify(); };
    socket.addEventListener("open", onOpen); socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError); socket.addEventListener("close", onClose);

    const nextEvent = async (): Promise<InferenceEvent | undefined> => {
      while (!queue.length) {
        if (failure) throw failure;
        if (context.signal.aborted) return undefined;
        if (closed) throw new Error("Alibaba ASR closed before task completion");
        await new Promise<void>((resolve) => { wake = resolve; });
      }
      return queue.shift();
    };
    const onAbort = () => { socket.close(); notify(); };
    context.signal.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => { failure = new Error("Alibaba ASR timed out"); socket.close(); notify(); },
      this.options.timeoutMs ?? 120_000);

    try {
      while (!opened && !context.signal.aborted) {
        await new Promise<void>((resolve) => { wake = resolve; });
        if (failure) throw failure;
        if (closed && !context.signal.aborted) throw new Error("Alibaba ASR socket closed before open");
      }
      if (context.signal.aborted) return;

      let event: InferenceEvent | undefined;
      do {
        event = await nextEvent();
        if (!event) return;
        if (event.header?.event === "task-failed") throw new Error("Alibaba ASR task failed");
      } while (event.header?.event !== "task-started");

      const feeder = (async () => {
        for await (const frame of frames) {
          if (context.signal.aborted) return;
          validateFrame(frame);
          socket.send(frame.payload);
        }
        if (!context.signal.aborted) socket.send(JSON.stringify({
          header: { action: "finish-task", task_id: taskId, streaming: "duplex" }, payload: { input: {} },
        }));
      })().catch((error: unknown) => {
        failure = error instanceof Error ? error : new Error("Alibaba ASR audio input failed"); notify();
      });

      const finalSegments: string[] = [];
      while (!context.signal.aborted) {
        const current = await nextEvent();
        if (!current) return;
        if (current.header?.task_id && current.header.task_id !== taskId) continue;
        const kind = current.header?.event;
        if (kind === "task-failed") throw new Error("Alibaba ASR task failed");
        if (kind === "result-generated") {
          const sentence = current.payload?.output?.sentence;
          if (!sentence || sentence.heartbeat || !sentence.text?.trim()) continue;
          if (sentence.sentence_end) finalSegments.push(sentence.text);
          else yield { type: "partial", text: sentence.text };
        } else if (kind === "task-finished") {
          await feeder;
          const text = finalSegments.join("").trim();
          if (text) yield { type: "final", text };
          return;
        }
      }
    } finally {
      clearTimeout(timeout);
      context.signal.removeEventListener("abort", onAbort);
      socket.removeEventListener("open", onOpen); socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError); socket.removeEventListener("close", onClose);
      socket.close();
    }
  }
}
