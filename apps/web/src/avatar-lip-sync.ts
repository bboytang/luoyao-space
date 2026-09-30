import { AvatarRuntime } from "../../../runtimes/avatar/src/runtime";
import { LipSyncPlaybackTimeline } from "../../../runtimes/realtime-device/src/lip-sync-playback-timeline";

/**
 * Browser-facing clock/source used to drive avatar mouth presentation from the
 * same clock that schedules PCM playback.
 */
export interface AvatarLipSyncSource {
  getPlaybackTime(): number;
  getMouthOpenAt(timeSeconds: number): number;
}

/**
 * Applies playback-timed lip-sync samples to the avatar. It intentionally does
 * not own requestAnimationFrame; the host render loop supplies the playback
 * clock on each visual frame.
 */
export class AvatarLipSyncDriver {
  constructor(
    private readonly avatar: AvatarRuntime,
    private readonly source: AvatarLipSyncSource,
  ) {}

  update(): void {
    const timeSeconds = this.source.getPlaybackTime();
    this.avatar.setMouthOpen(this.source.getMouthOpenAt(timeSeconds));
  }

  updateAt(timeSeconds: number): void {
    this.avatar.setMouthOpen(this.source.getMouthOpenAt(timeSeconds));
  }
}
