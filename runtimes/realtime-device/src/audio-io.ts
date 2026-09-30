import type { AudioFrame } from "./protocol";

export type AudioFrameHandler = (frame: AudioFrame) => void;

export interface RealtimeAudioInput {
  start(onFrame: AudioFrameHandler): Promise<void>;
  stop(): Promise<void>;
}

export interface RealtimeAudioOutput {
  play(frame: AudioFrame): Promise<void>;
  stop(): Promise<void>;
}
