import { describe, expect, it, vi } from "vitest";
import { AvatarRenderLoop, type AvatarRenderLoopScheduler } from "./avatar-render-loop";

function createScheduler() {
  let nextId = 1;
  const callbacks = new Map<number, () => void>();
  const scheduler: AvatarRenderLoopScheduler = {
    request: vi.fn((callback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    }),
    cancel: vi.fn((id) => {
      callbacks.delete(id);
    }),
  };

  return {
    scheduler,
    flushNext() {
      const next = callbacks.entries().next();
      if (next.done) return;
      const [id, callback] = next.value;
      callbacks.delete(id);
      callback();
    },
  };
}

describe("AvatarRenderLoop", () => {
  it("updates lip sync before rendering each visual frame", () => {
    const scheduler = createScheduler();
    const order: string[] = [];
    const lipSync = { update: vi.fn(() => order.push("lip-sync")) };
    const render = vi.fn(() => order.push("render"));
    const loop = new AvatarRenderLoop(scheduler.scheduler, lipSync, render);

    loop.start();
    scheduler.flushNext();

    expect(order).toEqual(["lip-sync", "render"]);
    expect(render).toHaveBeenCalledTimes(1);
    expect(scheduler.scheduler.request).toHaveBeenCalledTimes(2);
  });

  it("does not start a second loop when already running", () => {
    const scheduler = createScheduler();
    const loop = new AvatarRenderLoop(scheduler.scheduler, { update: vi.fn() }, vi.fn());

    loop.start();
    loop.start();

    expect(scheduler.scheduler.request).toHaveBeenCalledTimes(1);
  });

  it("cancels the pending visual frame when stopped", () => {
    const scheduler = createScheduler();
    const lipSync = { update: vi.fn() };
    const render = vi.fn();
    const loop = new AvatarRenderLoop(scheduler.scheduler, lipSync, render);

    loop.start();
    loop.stop();
    scheduler.flushNext();

    expect(scheduler.scheduler.cancel).toHaveBeenCalledTimes(1);
    expect(lipSync.update).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(loop.isRunning()).toBe(false);
  });

  it("can restart after being stopped", () => {
    const scheduler = createScheduler();
    const loop = new AvatarRenderLoop(scheduler.scheduler, { update: vi.fn() }, vi.fn());

    loop.start();
    loop.stop();
    loop.start();

    expect(scheduler.scheduler.request).toHaveBeenCalledTimes(2);
  });
});
