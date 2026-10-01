import type { AudioFrame } from "../../../runtimes/realtime-device/src/protocol";
import type { PcmVoiceActivitySample } from "../../../runtimes/realtime-device/src/voice-activity";

export interface VoiceActivityDetector {
  analyze(frame: AudioFrame): PcmVoiceActivitySample | undefined;
  reset?(): void;
}

export interface RealtimeBargeInTarget {
  isResponseActive(): boolean;
  interruptResponse(): Promise<void>;
}

export interface RealtimeBargeInControllerOptions {
  onInterruptError?: (error: unknown) => void;
}

/**
 * Turns a voice-activity rising edge into a response interruption.
 * The microphone lifecycle remains owned by RealtimeSession.
 */
export class RealtimeBargeInController {
  private previousActive = false;
  private interruptPromise?: Promise<void>;

  constructor(
    private readonly detector: VoiceActivityDetector,
    private readonly target: RealtimeBargeInTarget,
    private readonly options: RealtimeBargeInControllerOptions = {},
  ) {}

  handleFrame(frame: AudioFrame): void {
    const sample = this.detector.analyze(frame);
    if (!sample) return;

    const risingEdge = sample.active && !this.previousActive;
    this.previousActive = sample.active;

    if (!risingEdge || !this.target.isResponseActive() || this.interruptPromise) return;

    const operation = this.target.interruptResponse();
    this.interruptPromise = operation
      .catch((error) => {
        this.options.onInterruptError?.(error);
      })
      .finally(() => {
        if (this.interruptPromise === operation) {
          this.interruptPromise = undefined;
        }
      });
  }

  reset(): void {
    this.previousActive = false;
    this.detector.reset?.();
  }
}
