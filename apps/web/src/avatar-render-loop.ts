export interface AvatarRenderLoopScheduler {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

export interface AvatarRenderLoopLipSync {
  update(): void;
}

/**
 * Drives playback-timed avatar presentation from the browser's visual frame
 * clock. Rendering remains outside this class so the avatar runtime stays
 * renderer-agnostic.
 */
export class AvatarRenderLoop {
  private handle?: number;
  private running = false;

  constructor(
    private readonly scheduler: AvatarRenderLoopScheduler,
    private readonly lipSync: AvatarRenderLoopLipSync,
    private readonly render: () => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.handle !== undefined) {
      this.scheduler.cancel(this.handle);
      this.handle = undefined;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  private scheduleNext(): void {
    this.handle = this.scheduler.request(() => {
      this.handle = undefined;
      if (!this.running) return;

      this.lipSync.update();
      this.render();
      this.scheduleNext();
    });
  }
}
