import { describe, expect, it } from "vitest";
import { PcmPlaybackTimeline } from "./playback-timeline";
import type { AudioFrame } from "./protocol";

function pcmFrame(bytes: number, sampleRate = 24_000, channels = 1): AudioFrame {
  return {
    kind: "audio",
    codec: "pcm_s16le",
    sampleRate,
    channels,
    sequence: 0,
    payload: new Uint8Array(bytes),
  };
}

describe("PcmPlaybackTimeline", () => {
  it("schedules PCM frames consecutively on the presentation timeline", () => {
    const timeline = new PcmPlaybackTimeline();

    const first = timeline.schedule(pcmFrame(960), 10);
    const second = timeline.schedule(pcmFrame(960), 10.001);

    expect(first).toEqual({ startTime: 10, endTime: 10.02 });
    expect(second).toEqual({ startTime: 10.02, endTime: 10.04 });
  });

  it("catches up to the current playback clock after an underrun", () => {
    const timeline = new PcmPlaybackTimeline();

    timeline.schedule(pcmFrame(960), 10);
    const resumed = timeline.schedule(pcmFrame(960), 11);

    expect(resumed).toEqual({ startTime: 11, endTime: 11.02 });
  });

  it("accounts for multiple channels when calculating duration", () => {
    const timeline = new PcmPlaybackTimeline();

    const schedule = timeline.schedule(pcmFrame(1920, 48_000, 2), 5);

    expect(schedule).toEqual({ startTime: 5, endTime: 5.01 });
  });

  it("rejects non-PCM frames", () => {
    const timeline = new PcmPlaybackTimeline();
    const frame = { ...pcmFrame(960), codec: "opus" as const };

    expect(() => timeline.schedule(frame, 0)).toThrow(
      "PcmPlaybackTimeline requires valid PCM16 audio frames",
    );
  });

  it("can roll back the latest schedule", () => {
    const timeline = new PcmPlaybackTimeline();

    const first = timeline.schedule(pcmFrame(960), 10);
    const second = timeline.schedule(pcmFrame(960), 10);

    timeline.rollback(second);

    expect(timeline.getEndTime()).toBe(first.endTime);
    expect(timeline.schedule(pcmFrame(960), 10)).toEqual({
      startTime: first.endTime,
      endTime: first.endTime + 0.02,
    });
  });

  it("rejects rollback of a non-latest schedule", () => {
    const timeline = new PcmPlaybackTimeline();
    const first = timeline.schedule(pcmFrame(960), 10);
    timeline.schedule(pcmFrame(960), 10);

    expect(() => timeline.rollback(first)).toThrow(
      "PcmPlaybackTimeline can only roll back the latest schedule",
    );
  });

  it("can be reset for a new playback stream", () => {
    const timeline = new PcmPlaybackTimeline();

    timeline.schedule(pcmFrame(960), 10);
    timeline.reset();

    expect(timeline.schedule(pcmFrame(960), 2)).toEqual({
      startTime: 2,
      endTime: 2.02,
    });
  });
});
