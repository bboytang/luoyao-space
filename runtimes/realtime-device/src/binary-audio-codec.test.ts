import { describe, expect, it } from "vitest";
import { binaryAudioCodec } from "./binary-audio-codec";
import type { AudioFrame } from "./protocol";

describe("binary audio codec", () => {
  it("round-trips pcm frames", () => {
    const frame: AudioFrame = {
      kind: "audio",
      codec: "pcm_s16le",
      sampleRate: 24_000,
      channels: 1,
      sequence: 42,
      payload: new Uint8Array([0, 1, 254, 255]),
    };

    const decoded = binaryAudioCodec.decodeAudio(binaryAudioCodec.encodeAudio(frame));
    expect(decoded).toEqual(frame);
  });

  it("round-trips opus frames", () => {
    const frame: AudioFrame = {
      kind: "audio",
      codec: "opus",
      sampleRate: 48_000,
      channels: 2,
      sequence: 7,
      payload: new Uint8Array([1, 2, 3]),
    };

    expect(binaryAudioCodec.decodeAudio(binaryAudioCodec.encodeAudio(frame))).toEqual(frame);
  });

  it("rejects malformed frames", () => {
    expect(() => binaryAudioCodec.decodeAudio(new Uint8Array([1, 2, 3]))).toThrow();
    expect(() => binaryAudioCodec.decodeAudio(new Uint8Array(18))).toThrow();
  });
});
