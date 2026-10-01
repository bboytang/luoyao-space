/** Explicit, paid-provider smoke only. Never run from normal test/CI scripts. */
import { Pool } from "pg";
import type { AudioFrame } from "../../../runtimes/realtime-device/src/protocol";
import type { AudioStreamContext } from "../../../runtimes/realtime-device/src/audio-pipeline";
import { runAudioPipeline } from "../../../runtimes/realtime-device/src/pipeline-runner";
import { loadRealtimeConfig } from "./config";
import { createRealVoicePipeline } from "./real-voice-assembly";

async function main(): Promise<void> {
  if (process.env.M2B_LIVE_SMOKE !== "1") {
    throw new Error("Live paid-provider smoke requires explicit M2B_LIVE_SMOKE=1");
  }
  const config = loadRealtimeConfig();
  const real = config.realVoice;
  const identity = config.development.identity;
  if (!real || !config.development.enabled || !identity) {
    throw new Error("Live smoke requires real voice configuration and explicit loopback development identity");
  }
  const pool = new Pool({ connectionString: real.databaseUrl });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  const context: AudioStreamContext = {
    sessionId: crypto.randomUUID(), conversationId: crypto.randomUUID(),
    trustedIdentity: { userId: identity.userId, authorizedDeviceId: identity.deviceId },
    signal: controller.signal,
  };
  try {
    // Repository-safe spoken text is synthesized at runtime; no private recording is stored.
    const pipeline = createRealVoicePipeline(real, pool);
    const source = pipeline.tts;
    const sample: AudioFrame[] = [];
    for await (const event of source.synthesize({ messageId: crypto.randomUUID(),
      text: "你好，洛瑶。这是一次语音链路测试，请简短地回答我。" }, context)) {
      if (event.type === "audio") sample.push(event.frame);
    }
    if (!sample.length || !sample.some((frame) => frame.payload.some((byte) => byte !== 0))) {
      throw new Error("Live speech input was empty or silent");
    }
    let hasTranscript = false;
    let outputBytes = 0;
    let nonSilentOutput = false;
    for await (const event of runAudioPipeline(pipeline, (async function* () { yield* sample; })(), context)) {
      if (event.type === "error") throw event.error ?? new Error("Live pipeline failed");
      if (event.type === "aborted") throw new Error("Live pipeline aborted");
      if (event.type === "stt" && event.final && event.text?.trim()) hasTranscript = true;
      if (event.type === "tts_audio" && event.frame) {
        if (event.frame.codec !== "pcm_s16le" || event.frame.sampleRate !== 24_000 ||
          event.frame.channels !== 1 || event.frame.payload.length % 2 !== 0) {
          throw new Error("Live TTS output violated 24 kHz mono PCM16 contract");
        }
        outputBytes += event.frame.payload.length;
        if (event.frame.payload.some((byte) => byte !== 0)) nonSilentOutput = true;
      }
    }
    if (!hasTranscript || !nonSilentOutput || outputBytes === 0) {
      throw new Error("Live smoke did not produce a transcript and non-silent speech output");
    }
    console.log(`M2-B live smoke passed: ASR final, Brain response, ${outputBytes} PCM output bytes, non-silent`);
  } finally {
    clearTimeout(timer);
    controller.abort();
    await pool.end();
  }
}

void main().catch((error) => {
  // Avoid logging provider response bodies, transcripts, credentials or user context.
  console.error("M2-B live smoke failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
