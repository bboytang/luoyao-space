import type { AudioStreamContext, TtsEvent, TtsInput, TtsProvider } from "../../../../runtimes/realtime-device/src/audio-pipeline";

export interface OpenAiTtsOptions {
  apiKey: string;
  model: string;
  voice: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export class OpenAiTtsProvider implements TtsProvider {
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(private readonly options: OpenAiTtsOptions) {
    if (!options.apiKey.trim()) throw new Error("OpenAI TTS API key is required");
    if (!options.model.trim()) throw new Error("OpenAI TTS model is required");
    if (!options.voice.trim()) throw new Error("OpenAI TTS voice is required");
    if (!Number.isInteger(options.timeoutMs ?? 60_000) || (options.timeoutMs ?? 60_000) <= 0) {
      throw new Error("OpenAI TTS timeout must be a positive integer");
    }
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async *synthesize(input: TtsInput, context: AudioStreamContext): AsyncIterable<TtsEvent> {
    if (context.signal.aborted) throw new Error("OpenAI TTS aborted");
    if (!input.text.trim()) throw new Error("OpenAI TTS input text is required");

    const deadline = AbortSignal.timeout(this.options.timeoutMs ?? 60_000);
    const signal = AbortSignal.any([context.signal, deadline]);
    let response: Response;
    try {
      response = await this.fetchImpl(`${(this.options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/audio/speech`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.options.model,
          voice: this.options.voice,
          input: input.text,
          response_format: "pcm",
        }),
        signal,
      });
    } catch (error) {
      if (deadline.aborted) throw new Error("OpenAI TTS timed out");
      throw error;
    }
    if (!response.ok) throw new Error(`OpenAI TTS failed with HTTP ${response.status}`);
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "audio/pcm" && contentType !== "application/octet-stream") {
      throw new Error(`OpenAI TTS returned an unsupported content type/format: ${contentType ?? "missing"}`);
    }
    if (!response.body) throw new Error("OpenAI TTS returned no audio stream");

    yield { type: "started" };
    const reader = response.body.getReader();
    const cancelReader = () => { void reader.cancel(); };
    signal.addEventListener("abort", cancelReader, { once: true });
    let pendingByte: number | undefined;
    let sequence = 0;
    let hasSpeech = false;
    try {
      while (true) {
        if (deadline.aborted) throw new Error("OpenAI TTS timed out");
        if (context.signal.aborted) throw new Error("OpenAI TTS aborted");
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.length) continue;
        const bytes = pendingByte === undefined ? value : new Uint8Array([pendingByte, ...value]);
        const alignedLength = bytes.length - (bytes.length % 2);
        pendingByte = alignedLength < bytes.length ? bytes[alignedLength] : undefined;
        if (!alignedLength) continue;
        const payload = bytes.slice(0, alignedLength);
        if (payload.some((byte) => byte !== 0)) hasSpeech = true;
        yield {
          type: "audio",
          frame: { kind: "audio", codec: "pcm_s16le", sampleRate: 24_000, channels: 1, sequence: sequence++, payload },
        };
      }
    } finally {
      signal.removeEventListener("abort", cancelReader);
      reader.releaseLock();
    }
    if (deadline.aborted) throw new Error("OpenAI TTS timed out");
    if (pendingByte !== undefined) throw new Error("OpenAI TTS returned an incomplete PCM sample");
    if (!hasSpeech) throw new Error("OpenAI TTS returned silent or empty audio");
    yield { type: "completed" };
  }
}
