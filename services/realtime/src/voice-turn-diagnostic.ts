import type { PipelineStageDiagnostic } from "../../../runtimes/realtime-device/src/audio-pipeline";
import type { AudioFrame } from "../../../runtimes/realtime-device/src/protocol";

export type VoiceTurnStage =
  | "listen_start" | "input_received" | "listen_stop"
  | "asr_partial" | "asr_final" | "asr_completed"
  | "brain_started" | "brain_completed"
  | "tts_started" | "tts_first_audio_produced" | "tts_first_audio_sent" | "tts_completed"
  | "terminal";

export type VoiceTurnFailureStage = "input" | "asr" | "brain" | "tts" | "output" | "unknown";
export type VoiceTurnOutcome = "completed" | "cancelled" | "failed";

/** Fixed fields only: never attach text, error objects, identity or transport metadata. */
export interface VoiceTurnDiagnostic {
  readonly stage: VoiceTurnStage;
  readonly inputFrames: number;
  readonly inputBytes: number;
  readonly listenStopReceived: boolean;
  readonly asrPartialEvents: number;
  readonly asrFinalEvents: number;
  readonly nonEmptyAsrFinal: boolean;
  readonly asrProviderCompleted: boolean;
  readonly brainStarted: boolean;
  readonly brainCompleted: boolean;
  readonly ttsStarted: boolean;
  readonly firstTtsAudioProduced: boolean;
  readonly firstTtsAudioSent: boolean;
  readonly outputFrames: number;
  readonly outputBytes: number;
  readonly ttsCompleted: boolean;
  readonly outcome?: VoiceTurnOutcome;
  readonly failureStage?: VoiceTurnFailureStage;
}

export class VoiceTurnDiagnosticRecorder {
  private inputFrames = 0;
  private inputBytes = 0;
  private listenStopReceived = false;
  private asrPartialEvents = 0;
  private asrFinalEvents = 0;
  private nonEmptyAsrFinal = false;
  private asrProviderCompleted = false;
  private brainStarted = false;
  private brainCompleted = false;
  private ttsStarts = 0;
  private ttsCompletions = 0;
  private firstTtsAudioProduced = false;
  private firstTtsAudioSent = false;
  private outputFrames = 0;
  private outputBytes = 0;
  private failureStage?: VoiceTurnFailureStage;

  constructor(private readonly callback?: (diagnostic: VoiceTurnDiagnostic) => void) {
    this.publish("listen_start");
  }

  input(frame: AudioFrame): void {
    this.inputFrames += 1;
    this.inputBytes += frame.payload.byteLength;
    if (this.inputFrames === 1) this.publish("input_received");
  }

  stop(): void {
    this.listenStopReceived = true;
    this.publish("listen_stop");
  }

  pipeline(event: PipelineStageDiagnostic): void {
    switch (event.type) {
      case "asr_partial":
        this.asrPartialEvents += 1;
        if (this.asrPartialEvents === 1) this.publish("asr_partial");
        break;
      case "asr_final":
        this.asrFinalEvents += 1;
        this.nonEmptyAsrFinal ||= event.nonEmpty;
        this.publish("asr_final");
        break;
      case "asr_completed":
        this.asrProviderCompleted = true;
        this.publish("asr_completed");
        break;
      case "brain_started":
        this.brainStarted = true;
        this.publish("brain_started");
        break;
      case "brain_completed":
        this.brainCompleted = true;
        this.publish("brain_completed");
        break;
      case "tts_started":
        this.ttsStarts += 1;
        this.publish("tts_started");
        break;
      case "tts_first_audio_produced":
        this.firstTtsAudioProduced = true;
        this.publish("tts_first_audio_produced");
        break;
      case "tts_completed":
        this.ttsCompletions += 1;
        this.publish("tts_completed");
        break;
      case "failed":
        this.failureStage = event.stage;
        break;
    }
  }

  outputSent(frame: AudioFrame): void {
    this.outputFrames += 1;
    this.outputBytes += frame.payload.byteLength;
    if (!this.firstTtsAudioSent) {
      this.firstTtsAudioSent = true;
      this.publish("tts_first_audio_sent");
    }
  }

  failedAt(stage: VoiceTurnFailureStage): void {
    this.failureStage ??= stage;
  }

  terminal(outcome: VoiceTurnOutcome): void {
    if (outcome === "failed") this.failureStage ??= "unknown";
    this.publish("terminal", outcome);
  }

  private publish(stage: VoiceTurnStage, outcome?: VoiceTurnOutcome): void {
    if (!this.callback) return;
    const diagnostic: VoiceTurnDiagnostic = {
      stage,
      inputFrames: this.inputFrames,
      inputBytes: this.inputBytes,
      listenStopReceived: this.listenStopReceived,
      asrPartialEvents: this.asrPartialEvents,
      asrFinalEvents: this.asrFinalEvents,
      nonEmptyAsrFinal: this.nonEmptyAsrFinal,
      asrProviderCompleted: this.asrProviderCompleted,
      brainStarted: this.brainStarted,
      brainCompleted: this.brainCompleted,
      ttsStarted: this.ttsStarts > 0,
      firstTtsAudioProduced: this.firstTtsAudioProduced,
      firstTtsAudioSent: this.firstTtsAudioSent,
      outputFrames: this.outputFrames,
      outputBytes: this.outputBytes,
      ttsCompleted: this.ttsStarts > 0 && this.ttsCompletions === this.ttsStarts,
      ...(outcome ? { outcome } : {}),
      ...(this.failureStage ? { failureStage: this.failureStage } : {}),
    };
    try {
      this.callback(diagnostic);
    } catch {
      // Diagnostics must never change voice-turn behavior.
    }
  }
}
