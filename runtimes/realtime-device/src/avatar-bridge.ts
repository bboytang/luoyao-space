import { AvatarRuntime } from "../../../runtimes/avatar/src/runtime";
import type { PipelineOutput } from "./pipeline-runner";
import type { LipSyncAnalyzer } from "./lip-sync";

/**
 * Bridges provider-neutral realtime pipeline output into avatar speaking state.
 * Audio output is authoritative: speaking starts on the first emitted audio frame
 * and ends only when the realtime response is completed or aborted.
 */
export class AvatarRealtimeBridge {
  constructor(
    private readonly avatar: AvatarRuntime,
    private readonly lipSync?: LipSyncAnalyzer,
  ) {}

  handleOutput(output: PipelineOutput): void {
    switch (output.type) {
      case "tts_audio":
        if (output.frame) {
          this.avatar.setSpeaking(true);
          const sample = this.lipSync?.analyze(output.frame);
          if (sample) this.avatar.setMouthOpen(sample.openness);
        }
        break;
      case "completed":
      case "aborted":
      case "error":
        this.avatar.setSpeaking(false);
        break;
      default:
        break;
    }
  }
}
