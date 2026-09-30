import type { LipSyncSample } from "./lip-sync";
import type { PlaybackSchedule } from "./playback-timeline";

export interface LipSyncCue {
  sequence: number;
  startTime: number;
  endTime: number;
  openness: number;
}

/**
 * Maps analyzed audio samples onto the same presentation clock used by PCM
 * playback. It does not own rendering; consumers sample the timeline from
 * their animation/render clock.
 */
export class LipSyncPlaybackTimeline {
  private cues: LipSyncCue[] = [];

  add(sample: LipSyncSample, schedule: PlaybackSchedule): LipSyncCue {
    const durationSeconds = schedule.endTime - schedule.startTime;
    if (
      !Number.isFinite(schedule.startTime) ||
      !Number.isFinite(schedule.endTime) ||
      schedule.endTime < schedule.startTime ||
      !Number.isFinite(sample.durationSeconds) ||
      sample.durationSeconds < 0
    ) {
      throw new Error("LipSyncPlaybackTimeline requires valid playback timing");
    }

    const cueDuration = Math.min(durationSeconds, sample.durationSeconds);
    const cue = {
      sequence: sample.sequence,
      startTime: schedule.startTime,
      endTime: schedule.startTime + cueDuration,
      openness: Math.max(0, Math.min(1, sample.openness)),
    };

    this.cues.push(cue);
    return cue;
  }

  sampleAt(timeSeconds: number): number {
    if (!Number.isFinite(timeSeconds)) return 0;

    for (let index = this.cues.length - 1; index >= 0; index -= 1) {
      const cue = this.cues[index];
      if (timeSeconds >= cue.startTime && timeSeconds < cue.endTime) {
        return cue.openness;
      }
    }

    return 0;
  }

  getCues(): readonly LipSyncCue[] {
    return this.cues;
  }

  reset(): void {
    this.cues = [];
  }
}
