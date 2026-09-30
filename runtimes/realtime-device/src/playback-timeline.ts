import type { AudioFrame } from "./protocol";

export interface PlaybackSchedule {
  startTime: number;
  endTime: number;
}

export class PcmPlaybackTimeline {
  private nextStartTime = 0;

  schedule(frame: AudioFrame, nowSeconds: number): PlaybackSchedule {
    if (
      frame.codec !== "pcm_s16le" ||
      frame.channels <= 0 ||
      frame.sampleRate <= 0 ||
      frame.payload.byteLength % 2 !== 0
    ) {
      throw new Error("PcmPlaybackTimeline requires valid PCM16 audio frames");
    }

    const sampleCount = frame.payload.byteLength / 2 / frame.channels;
    const durationSeconds = sampleCount / frame.sampleRate;
    const startTime = Math.max(nowSeconds, this.nextStartTime);
    const endTime = startTime + durationSeconds;

    this.nextStartTime = endTime;
    return { startTime, endTime };
  }

  rollback(schedule: PlaybackSchedule): void {
    if (schedule.endTime !== this.nextStartTime) {
      throw new Error("PcmPlaybackTimeline can only roll back the latest schedule");
    }
    this.nextStartTime = schedule.startTime;
  }

  getEndTime(): number {
    return this.nextStartTime;
  }

  reset(): void {
    this.nextStartTime = 0;
  }
}
