import type { AudioFrame } from "./protocol";

export interface PcmVoiceActivityDetectorOptions {
  /** RMS level required to count a frame as speech-like activity. */
  onsetThreshold?: number;
  /** RMS level below which an active detector may begin releasing. */
  offsetThreshold?: number;
  /** Consecutive above-threshold frames required to enter the active state. */
  onsetFrames?: number;
  /** Consecutive below-threshold frames required to leave the active state. */
  releaseFrames?: number;
}

export interface PcmVoiceActivitySample {
  active: boolean;
  rms: number;
}

export class PcmVoiceActivityDetector {
  private readonly onsetThreshold: number;
  private readonly offsetThreshold: number;
  private readonly onsetFrames: number;
  private readonly releaseFrames: number;
  private active = false;
  private consecutiveOnsetFrames = 0;
  private consecutiveReleaseFrames = 0;

  constructor(options: PcmVoiceActivityDetectorOptions = {}) {
    this.onsetThreshold = options.onsetThreshold ?? 0.03;
    this.offsetThreshold = options.offsetThreshold ?? 0.015;
    this.onsetFrames = options.onsetFrames ?? 2;
    this.releaseFrames = options.releaseFrames ?? 5;

    if (
      !Number.isFinite(this.onsetThreshold) ||
      this.onsetThreshold < 0 ||
      !Number.isFinite(this.offsetThreshold) ||
      this.offsetThreshold < 0 ||
      this.offsetThreshold > this.onsetThreshold ||
      !Number.isInteger(this.onsetFrames) ||
      this.onsetFrames < 1 ||
      !Number.isInteger(this.releaseFrames) ||
      this.releaseFrames < 1
    ) {
      throw new Error("PcmVoiceActivityDetector options are invalid");
    }
  }

  analyze(frame: AudioFrame): PcmVoiceActivitySample | undefined {
    if (
      frame.codec !== "pcm_s16le" ||
      frame.channels <= 0 ||
      frame.payload.byteLength < 2 ||
      frame.payload.byteLength % 2 !== 0
    ) {
      return undefined;
    }

    const view = new DataView(
      frame.payload.buffer,
      frame.payload.byteOffset,
      frame.payload.byteLength,
    );
    let sumSquares = 0;
    let samples = 0;

    for (let offset = 0; offset + 1 < view.byteLength; offset += 2) {
      const sample = view.getInt16(offset, true) / 32768;
      sumSquares += sample * sample;
      samples += 1;
    }

    if (samples === 0) return undefined;

    const rms = Math.sqrt(sumSquares / samples);

    if (!this.active) {
      this.consecutiveReleaseFrames = 0;
      if (rms >= this.onsetThreshold) {
        this.consecutiveOnsetFrames += 1;
        if (this.consecutiveOnsetFrames >= this.onsetFrames) {
          this.active = true;
          this.consecutiveOnsetFrames = 0;
        }
      } else {
        this.consecutiveOnsetFrames = 0;
      }
    } else {
      this.consecutiveOnsetFrames = 0;
      if (rms <= this.offsetThreshold) {
        this.consecutiveReleaseFrames += 1;
        if (this.consecutiveReleaseFrames >= this.releaseFrames) {
          this.active = false;
          this.consecutiveReleaseFrames = 0;
        }
      } else {
        this.consecutiveReleaseFrames = 0;
      }
    }

    return { active: this.active, rms };
  }

  isActive(): boolean {
    return this.active;
  }

  reset(): void {
    this.active = false;
    this.consecutiveOnsetFrames = 0;
    this.consecutiveReleaseFrames = 0;
  }
}
