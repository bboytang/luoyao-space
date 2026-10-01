import type { AudioStreamContext, TtsEvent, TtsInput, TtsProvider } from "../../../../runtimes/realtime-device/src/audio-pipeline";

export interface AlibabaTtsSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: unknown) => void): void;
  removeEventListener(type: "open" | "message" | "error" | "close", listener: (event: unknown) => void): void;
}

export interface AlibabaTtsOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly voice: string;
  readonly url: string;
  readonly timeoutMs?: number;
  readonly createTaskId?: () => string;
  readonly socketFactory: { create(url: string, options: { readonly headers: Record<string, string> }): AlibabaTtsSocket };
}

type QueuedMessage = { readonly type: "json"; readonly value: InferenceEvent } |
  { readonly type: "binary"; readonly value: Uint8Array };
interface InferenceEvent { readonly header?: { readonly task_id?: string; readonly event?: string } }

function messageData(event: unknown): string | Uint8Array | undefined {
  if (!event || typeof event !== "object" || !("data" in event)) return undefined;
  const data = (event as { data?: unknown }).data;
  if (typeof data === "string") return data;
  if (data instanceof Uint8Array) return new Uint8Array(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return undefined;
}

export class AlibabaCosyVoiceTtsProvider implements TtsProvider {
  constructor(private readonly options: AlibabaTtsOptions) {
    if (!options.apiKey.trim()) throw new Error("Alibaba TTS API key is required");
    if (options.model !== "cosyvoice-v3.5-flash") throw new Error("Alibaba TTS model must be cosyvoice-v3.5-flash");
    if (!options.voice.trim()) throw new Error("Alibaba TTS voice ID is required");
    if (!options.url.trim()) throw new Error("Alibaba TTS WebSocket URL is required");
    if (!Number.isInteger(options.timeoutMs ?? 60_000) || (options.timeoutMs ?? 60_000) <= 0) {
      throw new Error("Alibaba TTS timeout must be a positive integer");
    }
  }

  async *synthesize(input: TtsInput, context: AudioStreamContext): AsyncIterable<TtsEvent> {
    if (!input.text.trim()) throw new Error("Alibaba TTS input text is required");
    if (context.signal.aborted) throw new Error("Alibaba TTS aborted");
    const taskId = (this.options.createTaskId ?? (() => crypto.randomUUID()))();
    const socket = this.options.socketFactory.create(this.options.url,
      { headers: { Authorization: `Bearer ${this.options.apiKey}` } });
    const queue: QueuedMessage[] = [];
    let wake: (() => void) | undefined;
    let opened = false;
    let started = false;
    let closed = false;
    let failure: Error | undefined;
    const notify = () => { const current = wake; wake = undefined; current?.(); };
    const sendFinish = (cancel: boolean) => socket.send(JSON.stringify({
      header: { action: "finish-task", task_id: taskId, streaming: "duplex" },
      payload: { input: cancel ? { directive: "cancel" } : {} },
    }));
    const onOpen = () => {
      opened = true;
      socket.send(JSON.stringify({
        header: { action: "run-task", task_id: taskId, streaming: "duplex" },
        payload: { task_group: "audio", task: "tts", function: "SpeechSynthesizer", model: this.options.model,
          parameters: { text_type: "PlainText", voice: this.options.voice, format: "pcm", sample_rate: 24_000 }, input: {} },
      }));
      notify();
    };
    const onMessage = (event: unknown) => {
      const data = messageData(event);
      if (typeof data === "string") {
        try { queue.push({ type: "json", value: JSON.parse(data) as InferenceEvent }); }
        catch { failure = new Error("Alibaba TTS returned invalid JSON"); }
      } else if (data) queue.push({ type: "binary", value: data });
      notify();
    };
    const onError = () => { failure = new Error("Alibaba TTS WebSocket error"); notify(); };
    const onClose = () => { closed = true; notify(); };
    const onAbort = () => { if (started) sendFinish(true); socket.close(); notify(); };
    socket.addEventListener("open", onOpen); socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError); socket.addEventListener("close", onClose);
    context.signal.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => { failure = new Error("Alibaba TTS timed out"); socket.close(); notify(); },
      this.options.timeoutMs ?? 60_000);
    const nextMessage = async (): Promise<QueuedMessage | undefined> => {
      while (!queue.length) {
        if (failure) throw failure;
        if (context.signal.aborted) return undefined;
        if (closed) throw new Error("Alibaba TTS closed before task completion");
        await new Promise<void>((resolve) => { wake = resolve; });
      }
      return queue.shift();
    };

    try {
      while (!opened && !context.signal.aborted) {
        await new Promise<void>((resolve) => { wake = resolve; });
        if (failure) throw failure;
        if (closed && !context.signal.aborted) throw new Error("Alibaba TTS socket closed before open");
      }
      if (context.signal.aborted) return;
      while (!started) {
        const message = await nextMessage();
        if (!message) return;
        if (message.type !== "json") continue;
        if (message.value.header?.event === "task-failed") throw new Error("Alibaba TTS task failed");
        if (message.value.header?.event === "task-started") started = true;
      }
      socket.send(JSON.stringify({ header: { action: "continue-task", task_id: taskId, streaming: "duplex" },
        payload: { input: { text: input.text } } }));
      sendFinish(false);
      yield { type: "started" };

      let pendingByte: number | undefined;
      let sequence = 0;
      let hasSpeech = false;
      while (!context.signal.aborted) {
        const message = await nextMessage();
        if (!message) return;
        if (message.type === "json") {
          if (message.value.header?.task_id && message.value.header.task_id !== taskId) continue;
          if (message.value.header?.event === "task-failed") throw new Error("Alibaba TTS task failed");
          if (message.value.header?.event !== "task-finished") continue;
          if (pendingByte !== undefined) throw new Error("Alibaba TTS returned an incomplete PCM sample");
          if (!hasSpeech) throw new Error("Alibaba TTS returned silent or empty audio");
          yield { type: "completed" };
          return;
        }
        const bytes = pendingByte === undefined ? message.value : new Uint8Array([pendingByte, ...message.value]);
        const alignedLength = bytes.length - (bytes.length % 2);
        pendingByte = alignedLength < bytes.length ? bytes[alignedLength] : undefined;
        if (!alignedLength) continue;
        const payload = bytes.slice(0, alignedLength);
        if (payload.some((byte) => byte !== 0)) hasSpeech = true;
        yield { type: "audio", frame: { kind: "audio", codec: "pcm_s16le", sampleRate: 24_000,
          channels: 1, sequence: sequence++, payload } };
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
