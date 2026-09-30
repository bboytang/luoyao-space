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
      await this.resources.closeRealtime();
      this.resources.disposeRuntime();
    })();

    await this.disposePromise;
  }
}
