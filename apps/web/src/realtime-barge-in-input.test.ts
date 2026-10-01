import { describe, expect, it, vi } from "vitest";
import type { AudioFrame } from "../../../runtimes/realtime-device/src/protocol";
import { RealtimeBargeInController, type VoiceActivityDetector } from "./realtime-barge-in";
import { RealtimeBargeInInput } from "./realtime-barge-in-input";

const frame: AudioFrame = {
  kind: "audio",
  codec: "pcm_s16le",
  sampleRate: 24_000,
  channels: 1,
  sequence: 1,
  payload: new Uint8Array([0, 0]),
};

describe("RealtimeBargeInInput", () => {
  it("holds the triggering audio frame until response interruption completes", async () => {
    let captureHandler!: (frame: AudioFrame) => void;
    let releaseInterrupt!: () => void;
    const source = {
      start: vi.fn(async (handler: (frame: AudioFrame) => void) => {
        captureHandler = handler;
      }),
      stop: vi.fn().mockResolvedValue(undefined),
    };

    const detector: VoiceActivityDetector = {
      analyze: vi.fn(() => ({ active: true, rms: 0.08 })),
      reset: vi.fn(),
    };
    const target = {
      isResponseActive: vi.fn(() => true),
      interruptResponse: vi.fn(
        () => new Promise<void>((resolve) => { releaseInterrupt = resolve; }),
      ),
    };
    const controller = new RealtimeBargeInController(detector, target);
    const input = new RealtimeBargeInInput(source, controller);
    const onFrame = vi.fn();

    await input.start(onFrame);
    captureHandler(frame);
    await Promise.resolve();

    expect(target.interruptResponse).toHaveBeenCalledTimes(1);
    expect(onFrame).not.toHaveBeenCalled();

    releaseInterrupt();
    await vi.waitFor(() => expect(onFrame).toHaveBeenCalledWith(frame));
  });

  it("drops pending frames after capture is stopped", async () => {
    let captureHandler!: (frame: AudioFrame) => void;
    let releaseInterrupt!: () => void;
    const source = {
      start: vi.fn(async (handler: (frame: AudioFrame) => void) => {
        captureHandler = handler;
      }),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const detector: VoiceActivityDetector = {
      analyze: vi.fn(() => ({ active: true, rms: 0.08 })),
      reset: vi.fn(),
    };
    const target = {
      isResponseActive: vi.fn(() => true),
      interruptResponse: vi.fn(
        () => new Promise<void>((resolve) => { releaseInterrupt = resolve; }),
      ),
    };
    const input = new RealtimeBargeInInput(
      source,
      new RealtimeBargeInController(detector, target),
    );
    const onFrame = vi.fn();

    await input.start(onFrame);
    captureHandler(frame);
    await Promise.resolve();
    await input.stop();

    releaseInterrupt();
    await Promise.resolve();
    await Promise.resolve();

    expect(onFrame).not.toHaveBeenCalled();
  });

  it("resets the barge-in detector when capture stops", async () => {
    const source = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const detector: VoiceActivityDetector = {
      analyze: vi.fn(),
      reset: vi.fn(),
    };
    const target = {
      isResponseActive: vi.fn(() => false),
      interruptResponse: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new RealtimeBargeInController(detector, target);
    const input = new RealtimeBargeInInput(source, controller);

    await input.start(vi.fn());
    await input.stop();

    expect(detector.reset).toHaveBeenCalledTimes(2);
    expect(source.stop).toHaveBeenCalledTimes(1);
  });
});
