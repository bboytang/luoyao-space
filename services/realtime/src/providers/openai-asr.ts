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

export interface OpenAiAsrOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly url?: string;
  readonly language?: string;
  readonly WebSocket?: new (url: string, protocols?: string | string[]) => OpenAiAsrSocket;
}

interface OpenAiAsrServerEvent {
  readonly type?: string;
  readonly delta?: string;
  readonly transcript?: string;
  readonly error?: { readonly message?: string; readonly code?: string };
}

interface OpenAiAsrClientEvent {
  readonly type: string;
  readonly audio?: string;
  readonly session?: Record<string, unknown>;
}

function toBase64(payload: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < payload.length; offset += chunkSize) {
    binary += String.fromCharCode(...payload.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

function createAudioAppend(frame: AudioFrame): OpenAiAsrClientEvent {
  if (frame.codec !== "pcm_s16le") {
    throw new Error("OpenAI realtime transcription requires PCM16 audio");
  }

  if (frame.channels !== 1) {
    throw new Error("OpenAI realtime transcription requires mono audio");
  }

  return {
    type: "input_audio_buffer.append",
    audio: toBase64(frame.payload),
  };
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
  private readonly WebSocketImpl: NonNullable<OpenAiAsrOptions["WebSocket"]>;

  constructor(private readonly options: OpenAiAsrOptions) {
    if (!options.apiKey.trim()) throw new Error("OpenAI API key is required");
    if (!options.model.trim()) throw new Error("OpenAI ASR model is required");

    const implementation = options.WebSocket ?? globalThis.WebSocket;
    if (!implementation) {
      throw new Error("WebSocket is required for OpenAI realtime transcription");
    }

    this.WebSocketImpl = implementation as NonNullable<OpenAiAsrOptions["WebSocket"]>;
  }

  async *transcribe(
    frames: AsyncIterable<AudioFrame>,
    context: AudioStreamContext,
  ): AsyncIterable<AsrEvent> {
    const socket = new this.WebSocketImpl(
      this.options.url ??
        "wss://api.openai.com/v1/realtime?intent=transcription",
      ["realtime"],
    );

    const queue: OpenAiAsrServerEvent[] = [];
    let wake: (() => void) | undefined;
    let closed = false;
    let failure: Error | undefined;

    const notify = () => {
      const resolver = wake;
      wake = undefined;
      resolver?.();
    };

    const onOpen = () => {
      const session: Record<string, unknown> = {
        type: "transcription_session.update",
        session: {
          input_audio_format: "pcm16",
          input_audio_transcription: {
            model: this.options.model,
            ...(this.options.language ? { language: this.options.language } : {}),
          },
        },
      };
      socket.send(JSON.stringify(session));
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

    try {
      for await (const frame of frames) {
        if (context.signal.aborted) return;

        socket.send(JSON.stringify(createAudioAppend(frame)));

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

        if (failure) throw failure;
        if (closed) throw new Error("OpenAI realtime transcription socket closed");
      }

      socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));

      while (!context.signal.aborted) {
        if (queue.length === 0) {
          if (failure) throw failure;
          if (closed) break;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }

        const event = queue.shift()!;
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
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      socket.close();
    }
  }
}
