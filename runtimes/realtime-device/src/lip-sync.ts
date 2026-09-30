import type { AudioFrame } from "./protocol";

export interface LipSyncSample {
  /** Monotonic audio sequence number from the realtime stream. */
  sequence: number;
  /** Presentation timestamp inherited from the audio frame, when available. */
  timestampMs?: number;
  /** Normalized mouth-open intensity, 0 = closed and 1 = fully open. */
  openness: number;
}

export interface LipSyncAnalyzer {
  analyze(frame: AudioFrame): LipSyncSample | undefined;
}

/**
 * Provider-neutral PCM analyzer. It intentionally does not attempt to decode
 * compressed codecs; those must be decoded before reaching this boundary.
 */
export class PcmLipSyncAnalyzer implements LipSyncAnalyzer {
  analyze(frame: AudioFrame): LipSyncSample | undefined {
    if (frame.codec !== "pcm_s16le" || frame.payload.byteLength < 2) return undefined;

    const view = new DataView(frame.payload.buffer, frame.payload.byteOffset, frame.payload.byteLength);
    let sumSquares = 0;
    let samples = 0;
    for (let offset = 0; offset + 1 < view.byteLength; offset += 2) {
      const sample = view.getInt16(offset, true) / 32768;
      sumSquares += sample * sample;
      samples += 1;
    }
    if (samples === 0) return undefined;

    const rms = Math.sqrt(sumSquares / samples);
    return { sequence: frame.sequence, timestampMs: frame.timestampMs, openness: Math.min(1, rms * 4) };
  }
}
