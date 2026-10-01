import { describe, expect, it, vi } from "vitest";
import type { AudioFrame } from "../../../runtimes/realtime-device/src/protocol";
import type { PcmVoiceActivitySample } from "../../../runtimes/realtime-device/src/voice-activity";
import {
  RealtimeBargeInController,
  type RealtimeBargeInTarget,
  type VoiceActivityDetector,
} from "./realtime-barge-in";

const frame: AudioFrame = {
  kind: "audio",
  codec: "pcm_s16le",
  sampleRate: 24_000,
  channels: 1,
  sequence: 1,
  payload: new Uint8Array([0, 0]),
};

class FakeDetector implements VoiceActivityDetector {
  private samples: PcmVoiceActivitySample[] = [];

  queue(...samples: PcmVoiceActivitySample[]): void {
    this.samples.push(...samples);
  }

  analyze(): PcmVoiceActivitySample | undefined {
    return this.samples.shift();
  }

  reset = vi.fn();
}

describe("RealtimeBargeInController", () => {
  it("interrupts only on a voice-activity rising edge while a response is active", async () => {
    const detector = new FakeDetector();
    const target: RealtimeBargeInTarget = {
      isResponseActive: vi.fn(() => true),
      interruptResponse: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new RealtimeBargeInController(detector, target);

    detector.queue(
      { active: false, rms: 0.01 },
      { active: true, rms: 0.08 },
      { active: true, rms: 0.09 },
      { active: false, rms: 0.01 },
      { active: true, rms: 0.08 },
    );

    controller.handleFrame(frame);
    controller.handleFrame(frame);
    controller.handleFrame(frame);
    controller.handleFrame(frame);
    controller.handleFrame(frame);
    await Promise.resolve();

    expect(target.interruptResponse).toHaveBeenCalledTimes(2);
  });

  it("does not interrupt when the response is inactive", async () => {
    const detector = new FakeDetector();
    const target: RealtimeBargeInTarget = {
      isResponseActive: vi.fn(() => false),
      interruptResponse: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new RealtimeBargeInController(detector, target);

    detector.queue({ active: true, rms: 0.08 });
    controller.handleFrame(frame);
    await Promise.resolve();

    expect(target.interruptResponse).not.toHaveBeenCalled();
  });

  it("coalesces a second rising edge while interruption is in flight", async () => {
    const detector = new FakeDetector();
    let release!: () => void;
    const target: RealtimeBargeInTarget = {
      isResponseActive: vi.fn(() => true),
      interruptResponse: vi.fn(
        () => new Promise<void>((resolve) => { release = resolve; }),
      ),
    };
    const controller = new RealtimeBargeInController(detector, target);

    detector.queue(
      { active: true, rms: 0.08 },
      { active: false, rms: 0.01 },
      { active: true, rms: 0.08 },
    );
    controller.handleFrame(frame);
    controller.handleFrame(frame);
    controller.handleFrame(frame);

    expect(target.interruptResponse).toHaveBeenCalledTimes(1);

    release();
    await Promise.resolve();

    detector.queue({ active: false, rms: 0.01 }, { active: true, rms: 0.08 });
    controller.handleFrame(frame);
    controller.handleFrame(frame);
    await Promise.resolve();

    expect(target.interruptResponse).toHaveBeenCalledTimes(2);
  });

  it("reports interruption failures without leaving the controller stuck", async () => {
    const detector = new FakeDetector();
    const error = new Error("interrupt failed");
    const onInterruptError = vi.fn();
    const target: RealtimeBargeInTarget = {
      isResponseActive: vi.fn(() => true),
      interruptResponse: vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(undefined),
    };
    const controller = new RealtimeBargeInController(detector, target, { onInterruptError });

    detector.queue(
      { active: true, rms: 0.08 },
      { active: false, rms: 0.01 },
      { active: true, rms: 0.08 },
    );
    controller.handleFrame(frame);
    await Promise.resolve();
    await Promise.resolve();

    controller.handleFrame(frame);
    controller.handleFrame(frame);
    await Promise.resolve();

    expect(onInterruptError).toHaveBeenCalledWith(error);
    expect(target.interruptResponse).toHaveBeenCalledTimes(2);
  });

  it("resets detector and edge state", () => {
    const detector = new FakeDetector();
    const target: RealtimeBargeInTarget = {
      isResponseActive: vi.fn(() => true),
      interruptResponse: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new RealtimeBargeInController(detector, target);

    detector.queue({ active: true, rms: 0.08 });
    controller.handleFrame(frame);
    controller.reset();

    expect(detector.reset).toHaveBeenCalledTimes(1);
  });
});
