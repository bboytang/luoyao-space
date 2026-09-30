import { describe, expect, it } from "vitest";
import { PcmLipSyncAnalyzer } from "./lip-sync";
import type { AudioFrame } from "./protocol";

function frame(
  payload: Uint8Array,
  codec: AudioFrame["codec"] = "pcm_s16le",
  channels = 1,
  sampleRate = 16_000,
): AudioFrame {
  return { kind: "audio", codec, sampleRate, channels, sequence: 7, payload };
}

describe("PcmLipSyncAnalyzer", () => {
  it("maps silent PCM to a closed mouth", () => {
    expect(new PcmLipSyncAnalyzer().analyze(frame(new Uint8Array([0, 0, 0, 0])))).toEqual({
      sequence: 7,
      openness: 0,
      durationSeconds: 2 / 16_000,
    });
  });

  it("maps louder PCM to greater mouth openness", () => {
    const analyzer = new PcmLipSyncAnalyzer();
    const quiet = analyzer.analyze(frame(new Uint8Array([0x00, 0x10, 0x00, 0x10])))!;
    const loud = analyzer.analyze(frame(new Uint8Array([0xff, 0x7f, 0xff, 0x7f])))!;
    expect(loud.openness).toBeGreaterThan(quiet.openness);
    expect(loud.openness).toBeLessThanOrEqual(1);
  });

  it("derives duration from samples per channel", () => {
    const sample = new PcmLipSyncAnalyzer().analyze(
      frame(new Uint8Array(16), "pcm_s16le", 2, 8_000),
    )!;

    expect(sample.durationSeconds).toBe(2 / 8_000);
  });

  it("does not pretend to decode compressed audio", () => {
    expect(new PcmLipSyncAnalyzer().analyze(frame(new Uint8Array([1, 2, 3]), "opus"))).toBeUndefined();
  });

  it("rejects malformed PCM payloads", () => {
    expect(new PcmLipSyncAnalyzer().analyze(frame(new Uint8Array([1])))).toBeUndefined();
  });
});
