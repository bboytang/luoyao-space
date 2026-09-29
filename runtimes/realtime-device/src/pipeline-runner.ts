import type { AudioFrame } from "./protocol";
import type {
  AudioPipeline,
  AudioStreamContext,
  PipelineMetrics,
} from "./audio-pipeline";
import { AudioFrameBuffer } from "./audio-buffer";

export interface PipelineOutput {
  type: "stt" | "tts_audio" | "completed" | "aborted" | "error";
  text?: string;
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

  const feeder = (async () => {
    try {
      for await (const frame of input) {
        if (context.signal.aborted) break;

        metrics.inputFrames += 1;
        frames.push(frame);
      }
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
        yield { type: "stt", text: asrEvent.text };
        continue;
      }

      finalText = asrEvent.text;
      yield { type: "stt", text: finalText };
    }

    if (!finalText.trim()) {
      yield { type: "completed" };
      return;
    }

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

      if (llmEvent.type !== "sentence") continue;

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
          yield { type: "tts_audio", frame: ttsEvent.frame };
        }
      }
    }

    metrics.totalResponseMs = Date.now() - startedAt;
    yield { type: "completed" };
  } catch (error) {
    yield {
      type: "error",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  } finally {
    await feeder;
  }
}
