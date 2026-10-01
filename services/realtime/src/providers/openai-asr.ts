import type {
  AsrEvent,
  AsrProvider,
  AudioStreamContext,
} from "../../../../runtimes/realtime-device/src/audio-pipeline";
import type { AudioFrame } from "../../../../runtimes/realtime-device/src/protocol";

export interface OpenAiAsrSocket {
  send(data: string): void;
  close(): void;
  addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: unknown) => void,
  ): void;
  removeEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: unknown) => void,
  ): void;
}

export interface OpenAiAsrSocketFactory {
  create(
    url: string,
    options: { readonly headers: Record<string, string> },
  ): OpenAiAsrSocket;
}

export interface OpenAiAsrOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly url?: string;
  readonly sampleRate?: number;
  readonly language?: string;
  readonly timeoutMs?: number;
  readonly socketFactory: OpenAiAsrSocketFactory;
}

interface OpenAiAsrServerEvent {
  readonly type?: string;
  readonly delta?: string;
  readonly transcript?: string;
  readonly error?: { readonly message?: string; readonly code?: string };
}

function toBase64(payload: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < payload.length; offset += chunkSize) {
    binary += String.fromCharCode(...payload.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

function createAudioAppend(frame: AudioFrame, sampleRate: number): string {
  if (frame.codec !== "pcm_s16le") {
    throw new Error("OpenAI realtime transcription requires PCM16 audio");
  }

  if (frame.channels !== 1) {
    throw new Error("OpenAI realtime transcription requires mono audio");
  }

  if (frame.sampleRate !== sampleRate || frame.payload.length % 2 !== 0) {
    throw new Error(`OpenAI realtime transcription requires ${sampleRate} Hz aligned PCM16 samples`);
  }

  return JSON.stringify({
    type: "input_audio_buffer.append",
    audio: toBase64(frame.payload),
  });
}

function isMessageEvent(event: unknown): event is { data: string } {
  return (
    typeof event === "object" &&
    event !== null &&
    "data" in event &&
    typeof (event as { data?: unknown }).data === "string"
  );
}

export class OpenAiAsrProvider implements AsrProvider {
  constructor(private readonly options: OpenAiAsrOptions) {
    if (!options.apiKey.trim()) throw new Error("OpenAI API key is required");
    if (!options.model.trim()) throw new Error("OpenAI ASR model is required");
    if (!Number.isInteger(options.sampleRate ?? 24000) || (options.sampleRate ?? 24000) <= 0) {
      throw new Error("OpenAI ASR sample rate must be a positive integer");
    }
    if (!Number.isInteger(options.timeoutMs ?? 120_000) || (options.timeoutMs ?? 120_000) <= 0) {
      throw new Error("OpenAI ASR timeout must be a positive integer");
    }
  }

  async *transcribe(
    frames: AsyncIterable<AudioFrame>,
    context: AudioStreamContext,
  ): AsyncIterable<AsrEvent> {
    const socket = this.options.socketFactory.create(
      this.options.url ?? "wss://api.openai.com/v1/realtime?intent=transcription",
      { headers: { Authorization: `Bearer ${this.options.apiKey}` } },
    );

    const queue: OpenAiAsrServerEvent[] = [];
    let wake: (() => void) | undefined;
    let opened = false;
    let closed = false;
    let failure: Error | undefined;

    const notify = () => {
      const resolver = wake;
      wake = undefined;
      resolver?.();
    };

    const onOpen = () => {
      opened = true;
      socket.send(
        JSON.stringify({
          type: "session.update",
          session: {
            type: "transcription",
            audio: {
              input: {
                format: { type: "audio/pcm", rate: this.options.sampleRate ?? 24000 },
                transcription: {
                  model: this.options.model,
                  ...(this.options.language ? { languages: [this.options.language] } : {}),
                },
                turn_detection: null,
              },
            },
          },
        }),
      );
      notify();
    };

    const onMessage = (event: unknown) => {
      if (!isMessageEvent(event)) return;
      try {
        queue.push(JSON.parse(event.data) as OpenAiAsrServerEvent);
      } catch {
        failure = new Error("Invalid JSON from OpenAI realtime transcription");
      }
      notify();
    };

    const onError = () => {
      failure = new Error("OpenAI realtime transcription WebSocket error");
      notify();
    };

    const onClose = () => {
      closed = true;
      notify();
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);

    const nextEvent = async (): Promise<OpenAiAsrServerEvent | undefined> => {
      while (queue.length === 0) {
        if (failure) throw failure;
        if (closed) throw new Error("OpenAI realtime transcription closed without a final transcript");
        if (context.signal.aborted) return undefined;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      return queue.shift();
    };

    const onAbort = () => { socket.close(); notify(); };
    context.signal.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => {
      failure = new Error("OpenAI realtime transcription timed out");
      socket.close();
      notify();
    }, this.options.timeoutMs ?? 120_000);

    try {
      while (!opened && !context.signal.aborted) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        if (failure) throw failure;
        if (closed && !context.signal.aborted) throw new Error("OpenAI realtime transcription socket closed before open");
      }

      if (context.signal.aborted) return;

      for await (const frame of frames) {
        if (context.signal.aborted) return;
        if (closed) throw new Error("OpenAI realtime transcription closed without a final transcript");

        socket.send(createAudioAppend(frame, this.options.sampleRate ?? 24000));

        while (queue.length > 0) {
          const event = queue.shift()!;
          if (event.type === "conversation.item.input_audio_transcription.delta" && event.delta) {
            yield { type: "partial", text: event.delta };
          } else if (
            event.type === "conversation.item.input_audio_transcription.completed" &&
            event.transcript !== undefined
          ) {
            yield { type: "final", text: event.transcript };
          } else if (event.type === "error") {
            throw new Error(event.error?.message ?? event.error?.code ?? "OpenAI realtime transcription error");
          }
        }
      }

      if (context.signal.aborted) return;

      socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));

      while (!context.signal.aborted) {
        const event = await nextEvent();
        if (!event) break;

        if (event.type === "conversation.item.input_audio_transcription.delta" && event.delta) {
          yield { type: "partial", text: event.delta };
        } else if (
          event.type === "conversation.item.input_audio_transcription.completed" &&
          event.transcript !== undefined
        ) {
          yield { type: "final", text: event.transcript };
          break;
        } else if (event.type === "error") {
          throw new Error(event.error?.message ?? event.error?.code ?? "OpenAI realtime transcription error");
        }
      }
    } finally {
      clearTimeout(timeout);
      context.signal.removeEventListener("abort", onAbort);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      socket.close();
    }
  }
}
