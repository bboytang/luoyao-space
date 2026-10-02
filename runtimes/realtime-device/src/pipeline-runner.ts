import type { AudioFrame } from "./protocol";
import type {
  AudioPipeline,
  AudioStreamContext,
  PipelineStageDiagnostic,
  PipelineMetrics,
} from "./audio-pipeline";
import { AudioFrameBuffer } from "./audio-buffer";

export interface PipelineOutput {
  type: "stt" | "tts_audio" | "completed" | "aborted" | "error";
  text?: string;
  final?: boolean;
  frame?: AudioFrame;
  error?: Error;
}

export async function* runAudioPipeline(
  pipeline: AudioPipeline,
  input: AsyncIterable<AudioFrame>,
  context: AudioStreamContext,
): AsyncIterable<PipelineOutput> {
  const startedAt = Date.now();
  const metrics: PipelineMetrics = {
    inputFrames: 0,
    inputAudioMs: 0,
  };

  const frames = new AudioFrameBuffer({ maxFrames: 256 });

  const emitMetrics = () => {
    try { context.onMetrics?.({ ...metrics }); }
    catch { /* Observability must not affect the audio pipeline. */ }
  };
  const emitStage = (event: PipelineStageDiagnostic) => {
    try { context.onStageDiagnostic?.(event); }
    catch { /* Observability must not affect the audio pipeline. */ }
  };
  const markOnce = (key: keyof PipelineMetrics, elapsedMs: number) => {
    if (metrics[key] === undefined) {
      metrics[key] = elapsedMs;
      emitMetrics();
    }
  };

  let feederError: Error | undefined;
  let failureStage: "asr" | "brain" | "tts" = "asr";
  let firstTtsAudioProduced = false;

  const feeder = (async () => {
    try {
      for await (const frame of input) {
        if (context.signal.aborted) break;

        metrics.inputFrames += 1;
        frames.push(frame);
      }
    } catch (error) {
      feederError = error instanceof Error ? error : new Error(String(error));
    } finally {
      frames.end();
    }
  })();

  try {
    const asrEvents = pipeline.asr.transcribe(frames, context);
    let finalText = "";

    for await (const asrEvent of asrEvents) {
      if (context.signal.aborted) {
        yield { type: "aborted" };
        return;
      }

      if (asrEvent.type === "partial") {
        emitStage({ type: "asr_partial" });
        markOnce("asrFirstPartialMs", Date.now() - startedAt);
        yield { type: "stt", text: asrEvent.text, final: false };
        continue;
      }

      finalText = asrEvent.text;
      emitStage({ type: "asr_final", nonEmpty: !!finalText.trim() });
      markOnce("asrFinalMs", Date.now() - startedAt);
      yield { type: "stt", text: finalText, final: true };
    }
    emitStage({ type: "asr_completed" });

    if (!finalText.trim()) {
      await feeder;
      if (context.signal.aborted) {
        yield { type: "aborted" };
        return;
      }

      if (feederError) {
        emitStage({ type: "failed", stage: "input" });
        yield { type: "error", error: feederError };
        return;
      }

      yield { type: "completed" };
      return;
    }

    failureStage = "brain";
    emitStage({ type: "brain_started" });
    const llmEvents = pipeline.llm.stream(
      {
        text: finalText,
        conversationId: context.conversationId,
      },
      context,
    );

    for await (const llmEvent of llmEvents) {
      if (context.signal.aborted) {
        yield { type: "aborted" };
        return;
      }

      if (llmEvent.type === "text_delta") {
        markOnce("llmFirstTokenMs", Date.now() - startedAt);
        continue;
      }
      if (llmEvent.type !== "sentence") continue;

      markOnce("firstSentenceMs", Date.now() - startedAt);
      failureStage = "tts";
      emitStage({ type: "tts_started" });
      const ttsEvents = pipeline.tts.synthesize(
        {
          messageId: crypto.randomUUID(),
          text: llmEvent.text,
        },
        context,
      );

      for await (const ttsEvent of ttsEvents) {
        if (context.signal.aborted) {
          yield { type: "aborted" };
          return;
        }

        if (ttsEvent.type === "audio") {
          if (!firstTtsAudioProduced) {
            firstTtsAudioProduced = true;
            emitStage({ type: "tts_first_audio_produced" });
          }
          markOnce("ttsFirstAudioMs", Date.now() - startedAt);
          yield { type: "tts_audio", frame: ttsEvent.frame };
        }
      }
      emitStage({ type: "tts_completed" });
      failureStage = "brain";
    }
    emitStage({ type: "brain_completed" });

    await feeder;
    if (feederError) {
      emitStage({ type: "failed", stage: "input" });
      yield { type: "error", error: feederError };
      return;
    }

    metrics.totalResponseMs = Date.now() - startedAt;
    emitMetrics();
    yield { type: "completed" };
  } catch (error) {
    emitStage({ type: "failed", stage: failureStage });
    yield {
      type: "error",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  } finally {
    emitMetrics();
    if (context.signal.aborted) {
      frames.end();
    } else {
      await feeder;
    }
  }
}
