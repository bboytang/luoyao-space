import type { ModelGenerateRequest, ModelGenerateResult, ModelProvider } from "./model-router";
import type { VoiceModelContext } from "./voice-model-boundary";

export interface AlibabaBrainModelOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export class AlibabaBrainModelProvider implements ModelProvider {
  readonly id = "alibaba-brain";
  readonly supports = ["fast_chat"] as const;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(private readonly options: AlibabaBrainModelOptions) {
    if (!options.apiKey.trim()) throw new Error("Alibaba Brain API key is required");
    if (options.model !== "qwen-flash") throw new Error("Alibaba Brain model must be qwen-flash");
    if (!options.baseUrl.trim()) throw new Error("Alibaba Brain base URL is required");
    if (!Number.isInteger(options.timeoutMs ?? 60_000) || (options.timeoutMs ?? 60_000) <= 0) {
      throw new Error("Alibaba Brain model timeout must be a positive integer");
    }
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async generate(request: ModelGenerateRequest): Promise<ModelGenerateResult> {
    if (request.modelClass !== "fast_chat" || !isVoiceContext(request.input)) {
      throw new Error("A Brain conversation request is required");
    }
    const deadline = AbortSignal.timeout(this.options.timeoutMs ?? 60_000);
    const signal = request.signal ? AbortSignal.any([request.signal, deadline]) : deadline;
    if (signal.aborted) throw new Error("Alibaba Brain model aborted");
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: this.options.model, messages: [
          { role: "system", content: request.input.instructions },
          { role: "user", content: request.input.transcript },
        ] }),
        signal,
      });
    } catch {
      if (deadline.aborted) throw new Error("Alibaba Brain model timed out");
      if (request.signal?.aborted) throw new Error("Alibaba Brain model aborted");
      throw new Error("Alibaba Brain model request failed");
    }
    if (!response.ok) throw new Error(`Alibaba Brain model failed with HTTP ${response.status}`);
    let body: unknown;
    try { body = await response.json(); } catch { throw new Error("Alibaba Brain model returned invalid JSON"); }
    const content = body && typeof body === "object" && Array.isArray((body as { choices?: unknown }).choices)
      ? ((body as { choices: Array<{ message?: { content?: unknown } }> }).choices[0]?.message?.content) : undefined;
    if (typeof content !== "string" || !content.trim()) throw new Error("Alibaba Brain model returned empty output");
    return { text: content, providerId: this.id, modelId: this.options.model };
  }
}

function isVoiceContext(value: unknown): value is VoiceModelContext {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<VoiceModelContext>;
  return typeof input.transcript === "string" && !!input.transcript.trim() &&
    typeof input.instructions === "string" && !!input.instructions.trim() &&
    (input.responseLength === "very_short" || input.responseLength === "short" ||
      input.responseLength === "normal" || input.responseLength === "long") &&
    (input.responseTone === "calm" || input.responseTone === "warm" || input.responseTone === "playful" ||
      input.responseTone === "serious" || input.responseTone === "curious");
}
