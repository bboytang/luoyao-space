import type {
  AudioStreamContext,
  LlmEvent,
  LlmInput,
  LlmProvider,
} from "../../../../runtimes/realtime-device/src/audio-pipeline";

export interface OpenAiLlmOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
}

interface OpenAiStreamEvent {
  readonly type?: string;
  readonly delta?: string;
  readonly code?: string;
  readonly message?: string;
}

function sentenceBoundary(text: string): boolean {
  return /[。！？!?；;\n]$/.test(text.trim());
}

async function* parseSse(
  response: Response,
  signal: AbortSignal,
): AsyncGenerator<OpenAiStreamEvent> {
  if (!response.body) {
    throw new Error("OpenAI response did not include a streaming body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        const event = JSON.parse(payload) as OpenAiStreamEvent;
        if (event.type === "error") {
          throw new Error(event.message ?? event.code ?? "OpenAI streaming error");
        }
        yield event;
      }
    }

    const tail = buffer.trim();
    if (tail.startsWith("data:")) {
      const payload = tail.slice(5).trim();
      if (payload && payload !== "[DONE]") {
        yield JSON.parse(payload) as OpenAiStreamEvent;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export class OpenAiLlmProvider implements LlmProvider {
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(private readonly options: OpenAiLlmOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) throw new Error("fetch is required");
    if (!options.apiKey.trim()) throw new Error("OpenAI API key is required");
    if (!options.model.trim()) throw new Error("OpenAI model is required");
  }

  async *stream(
    input: LlmInput,
    context: AudioStreamContext,
  ): AsyncIterable<LlmEvent> {
    const baseUrl = this.options.baseUrl ?? "https://api.openai.com/v1";
    const response = await this.fetchImpl(
      `${baseUrl.replace(/\/$/, "")}/responses`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.options.model,
          input: input.text,
          stream: true,
        }),
        signal: context.signal,
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI Responses API failed (${response.status}): ${body.slice(0, 500)}`);
    }

    let sentence = "";

    try {
      for await (const event of parseSse(response, context.signal)) {
        if (context.signal.aborted) {
          yield { type: "done", finishReason: "abort" };
          return;
        }

        if (event.type === "response.output_text.delta" && event.delta) {
          sentence += event.delta;
          yield { type: "text_delta", text: event.delta };

          if (sentenceBoundary(sentence)) {
            yield { type: "sentence", text: sentence };
            sentence = "";
          }
        } else if (event.type === "response.completed") {
          if (sentence.trim()) {
            yield { type: "sentence", text: sentence };
            sentence = "";
          }
          yield { type: "done", finishReason: "stop" };
          return;
        } else if (event.type === "error") {
          throw new Error(event.message ?? event.code ?? "OpenAI streaming error");
        }
      }

      if (sentence.trim()) yield { type: "sentence", text: sentence };
      yield {
        type: "done",
        finishReason: context.signal.aborted ? "abort" : "stop",
      };
    } catch (error) {
      if (context.signal.aborted) {
        yield { type: "done", finishReason: "abort" };
        return;
      }
      throw error;
    }
  }
}
