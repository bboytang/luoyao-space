import { describe, expect, it, vi } from "vitest";
import { AppLifecycle } from "./app-lifecycle";

describe("AppLifecycle", () => {
  it("disposes resources in order", async () => {
    const events: string[] = [];
    const lifecycle = new AppLifecycle({
      stopRenderLoop: vi.fn(() => events.push("render-loop")),
      closeRealtime: vi.fn(async () => {
        events.push("realtime-start");
        await Promise.resolve();
        events.push("realtime-end");
      }),
      disposeRuntime: vi.fn(() => events.push("runtime")),
    });

    await lifecycle.dispose();

    expect(events).toEqual([
      "render-loop",
      "realtime-start",
      "realtime-end",
      "runtime",
    ]);
  });

  it("makes concurrent dispose calls share one cleanup", async () => {
    let release!: () => void;
    const closeRealtime = vi.fn(
      () => new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const lifecycle = new AppLifecycle({
      stopRenderLoop: vi.fn(),
      closeRealtime,
      disposeRuntime: vi.fn(),
    });

    const first = lifecycle.dispose();
    const second = lifecycle.dispose();

    await Promise.resolve();
    expect(closeRealtime).toHaveBeenCalledTimes(1);

    let secondFinished = false;
    void second.then(() => {
      secondFinished = true;
    });
    await Promise.resolve();
    expect(secondFinished).toBe(false);

    release();
    await Promise.all([first, second]);

    expect(secondFinished).toBe(true);
  });

  it("disposes the runtime even when realtime cleanup fails", async () => {
    const disposeRuntime = vi.fn();
    const error = new Error("realtime cleanup failed");
    const lifecycle = new AppLifecycle({
      stopRenderLoop: vi.fn(),
      closeRealtime: vi.fn().mockRejectedValue(error),
      disposeRuntime,
    });

    await expect(lifecycle.dispose()).rejects.toBe(error);
    expect(disposeRuntime).toHaveBeenCalledTimes(1);
  });

  it("keeps the same failed cleanup promise for later callers", async () => {
    const error = new Error("realtime cleanup failed");
    const closeRealtime = vi.fn().mockRejectedValue(error);
    const lifecycle = new AppLifecycle({
      stopRenderLoop: vi.fn(),
      closeRealtime,
      disposeRuntime: vi.fn(),
    });

    const first = lifecycle.dispose();
    const second = lifecycle.dispose();

    await expect(first).rejects.toBe(error);
    await expect(second).rejects.toBe(error);
    expect(closeRealtime).toHaveBeenCalledTimes(1);
  });
});
