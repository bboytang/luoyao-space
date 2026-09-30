export interface AppLifecycleResources {
  stopRenderLoop(): void;
  closeRealtime(): Promise<void>;
  disposeRuntime(): void;
}

export class AppLifecycle {
  private disposePromise?: Promise<void>;

  constructor(private readonly resources: AppLifecycleResources) {}

  async dispose(): Promise<void> {
    if (this.disposePromise) {
      await this.disposePromise;
      return;
    }

    this.disposePromise = (async () => {
      this.resources.stopRenderLoop();

      let cleanupError: unknown;
      try {
        await this.resources.closeRealtime();
      } catch (error) {
        cleanupError = error;
      }

      try {
        this.resources.disposeRuntime();
      } catch (error) {
        cleanupError ??= error;
      }

      if (cleanupError !== undefined) throw cleanupError;
    })();

    await this.disposePromise;
  }
}
