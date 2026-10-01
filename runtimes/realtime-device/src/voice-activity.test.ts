import { describe, expect, it } from "vitest";
import type { AudioFrame } from "./protocol";
import { PcmVoiceActivityDetector } from "./voice-activity";

function frame(amplitude: number, sequence = 1): AudioFrame {
  const samples = new Int16Array(4);
  samples.fill(Math.round(amplitude * 32767));
  return {
    kind: "audio",
    codec: "pcm_s16le",
    sampleRate: 24_000,
    channels: 1,
    sequence,
    payload: new Uint8Array(samples.buffer),
  };
}

describe("PcmVoiceActivityDetector", () => {
  it("requires consecutive active frames before entering the active state", () => {
    const detector = new PcmVoiceActivityDetector({
      onsetThreshold: 0.1,
      offsetThreshold: 0.05,
      onsetFrames: 2,
      releaseFrames: 2,
    });

    expect(detector.analyze(frame(0.2))?.active).toBe(false);
    expect(detector.analyze(frame(0.2))?.active).toBe(true);
  });

  it("requires consecutive quiet frames before releasing activity", () => {
    const detector = new PcmVoiceActivityDetector({
      onsetThreshold: 0.1,
      offsetThreshold: 0.05,
      onsetFrames: 1,
      releaseFrames: 2,
    });

    expect(detector.analyze(frame(0.2))?.active).toBe(true);
    expect(detector.analyze(frame(0.04))?.active).toBe(true);
    expect(detector.analyze(frame(0.04))?.active).toBe(false);
  });

  it("uses the offset threshold as hysteresis while active", () => {
    const detector = new PcmVoiceActivityDetector({
      onsetThreshold: 0.1,
      offsetThreshold: 0.05,
      onsetFrames: 1,
      releaseFrames: 1,
    });

    expect(detector.analyze(frame(0.2))?.active).toBe(true);
    expect(detector.analyze(frame(0.08))?.active).toBe(true);
    expect(detector.analyze(frame(0.04))?.active).toBe(false);
  });

  it("reports rms for valid pcm frames", () => {
    const detector = new PcmVoiceActivityDetector();

    const sample = detector.analyze(frame(0.25));

    expect(sample?.rms).toBeCloseTo(0.25, 3);
  });

  it("ignores non-pcm and malformed frames", () => {
    const detector = new PcmVoiceActivityDetector();

    expect(
      detector.analyze({
        ...frame(0.2),
        codec: "opus",
      }),
    ).toBeUndefined();

    expect(
      detector.analyze({
        ...frame(0.2),
        payload: new Uint8Array([1]),
      }),
    ).toBeUndefined();

    expect(detector.isActive()).toBe(false);
  });

  it("resets pending onset and active state", () => {
    const detector = new PcmVoiceActivityDetector({
      onsetThreshold: 0.1,
      onsetFrames: 2,
    });

    detector.analyze(frame(0.2));
    detector.reset();

    expect(detector.isActive()).toBe(false);
    expect(detector.analyze(frame(0.2))?.active).toBe(false);
  });

  it("rejects invalid configuration", () => {
    expect(() => new PcmVoiceActivityDetector({ onsetThreshold: -1 })).toThrow();
    expect(() =>
      new PcmVoiceActivityDetector({
        onsetThreshold: 0.1,
        offsetThreshold: 0.2,
      }),
    ).toThrow();
    expect(() => new PcmVoiceActivityDetector({ onsetFrames: 0 })).toThrow();
    expect(() => new PcmVoiceActivityDetector({ releaseFrames: 0 })).toThrow();
  });
});
