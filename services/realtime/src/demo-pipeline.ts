import type {
  AudioPipeline,
  AudioStreamContext,
  AsrProvider,
  LlmProvider,
  TtsProvider,
  VadProvider,
} from "../../../runtimes/realtime-device/src/audio-pipeline";
import type { AudioFrame } from "../../../runtimes/realtime-device/src/protocol";

const demoAudioFrame: AudioFrame = {
  kind: "audio",
  codec: "pcm_s16le",
  sampleRate: 24_000,
  channels: 1,
  sequence: 0,
  payload: new Uint8Array(960),
};

const vad: VadProvider = {
  async detect(_frame: AudioFrame, _context: AudioStreamContext) {
    return { speech: true, startOfSpeech: true, endOfSpeech: false };
  },
};

const asr: AsrProvider = {
  async *transcribe(frames: AsyncIterable<AudioFrame>) {
    for await (const _frame of frames) {
      yield { type: "partial", text: "你好" };
      yield { type: "final", text: "你好" };
      return;
    }
  },
};

const llm: LlmProvider = {
  async *stream() {
    yield { type: "text_delta", text: "你好，我在这里。" };
    yield { type: "sentence", text: "你好，我在这里。" };
    yield { type: "done", finishReason: "stop" };
  },
};

const tts: TtsProvider = {
  async *synthesize() {
    yield { type: "started" };
    yield { type: "audio", frame: demoAudioFrame };
    yield { type: "completed" };
  },
};

export function createDemoRealtimePipeline(): AudioPipeline {
  return { vad, asr, llm, tts };
}
