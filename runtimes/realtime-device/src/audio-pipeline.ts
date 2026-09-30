import type { AudioFrame } from "./protocol";

export interface AudioStreamContext {
  sessionId: string;
  conversationId: string;
  signal: AbortSignal;
  onMetrics?: (metrics: Readonly<PipelineMetrics>) => void;
}

export interface VadProvider {
  detect(frame: AudioFrame, context: AudioStreamContext): Promise<VadResult>;
}

export interface VadResult {
  speech: boolean;
  startOfSpeech: boolean;
  endOfSpeech: boolean;
  confidence?: number;
}

export interface AsrProvider {
  transcribe(
    frames: AsyncIterable<AudioFrame>,
    context: AudioStreamContext,
  ): AsyncIterable<AsrEvent>;
}

export type AsrEvent =
  | {
      type: "partial";
      text: string;
    }
  | {
      type: "final";
      text: string;
    };

export interface LlmProvider {
  stream(
    input: LlmInput,
    context: AudioStreamContext,
  ): AsyncIterable<LlmEvent>;
}

export interface LlmInput {
  text: string;
  conversationId: string;
  metadata?: Record<string, unknown>;
}

export type LlmEvent =
  | {
      type: "text_delta";
      text: string;
    }
  | {
      type: "sentence";
      text: string;
    }
  | {
      type: "done";
      finishReason: "stop" | "abort" | "error";
    };

export interface TtsProvider {
  synthesize(
    input: TtsInput,
    context: AudioStreamContext,
  ): AsyncIterable<TtsEvent>;
}

export interface TtsInput {
  messageId: string;
  text: string;
  voice?: string;
  emotion?: string;
}

export type TtsEvent =
  | {
      type: "audio";
      frame: AudioFrame;
    }
  | {
      type: "started";
    }
  | {
      type: "completed";
    };

export interface AudioPipeline {
  vad: VadProvider;
  asr: AsrProvider;
  llm: LlmProvider;
  tts: TtsProvider;
}

export interface PipelineMetrics {
  inputFrames: number;
  inputAudioMs: number;
  asrFirstPartialMs?: number;
  asrFinalMs?: number;
  llmFirstTokenMs?: number;
  firstSentenceMs?: number;
  ttsFirstAudioMs?: number;
  totalResponseMs?: number;
}

export function createPipelineAbortController(): AbortController {
  return new AbortController();
}
