import { describe, expect, it } from "vitest";
import type { LipSyncSample } from "./lip-sync";
import { LipSyncPlaybackTimeline } from "./lip-sync-playback-timeline";
import type { PlaybackSchedule } from "./playback-timeline";

function sample(sequence: number, openness: number, durationSeconds: number): LipSyncSample {
  return { sequence, openness, durationSeconds };
}

function schedule(startTime: number, endTime: number): PlaybackSchedule {
  return { startTime, endTime };
}

describe("LipSyncPlaybackTimeline", () => {
  it("samples openness on the playback clock", () => {
    const timeline = new LipSyncPlaybackTimeline();

    timeline.add(sample(1, 0.25, 0.1), schedule(10, 10.1));
    timeline.add(sample(2, 0.8, 0.1), schedule(10.1, 10.2));

    expect(timeline.sampleAt(9.99)).toBe(0);
    expect(timeline.sampleAt(10)).toBe(0.25);
    expect(timeline.sampleAt(10.099)).toBe(0.25);
    expect(timeline.sampleAt(10.1)).toBe(0.8);
    expect(timeline.sampleAt(10.2)).toBe(0);
  });

  it("never extends a cue beyond its actual playback schedule", () => {
    const timeline = new LipSyncPlaybackTimeline();

    timeline.add(sample(1, 0.9, 0.2), schedule(3, 3.05));

    expect(timeline.sampleAt(3.049)).toBe(0.9);
    expect(timeline.sampleAt(3.05)).toBe(0);
  });

  it("clamps openness to the avatar range", () => {
    const timeline = new LipSyncPlaybackTimeline();

    timeline.add(sample(1, 2, 0.1), schedule(1, 1.1));
    expect(timeline.sampleAt(1.05)).toBe(1);

    timeline.reset();
    timeline.add(sample(2, -1, 0.1), schedule(1, 1.1));
    expect(timeline.sampleAt(1.05)).toBe(0);
  });

  it("rejects invalid playback timing", () => {
    const timeline = new LipSyncPlaybackTimeline();

    expect(() => timeline.add(sample(1, 0.5, 0.1), schedule(2, 1))).toThrow();
    expect(() => timeline.add(sample(1, 0.5, -0.1), schedule(1, 2))).toThrow();
  });

  it("resets all cues for a new response", () => {
    const timeline = new LipSyncPlaybackTimeline();
    timeline.add(sample(1, 0.5, 0.1), schedule(1, 1.1));

    timeline.reset();

    expect(timeline.getCues()).toEqual([]);
    expect(timeline.sampleAt(1.05)).toBe(0);
  });
});
