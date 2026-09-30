import { AvatarRuntime } from "../../../runtimes/avatar/src/runtime";
import type { PipelineOutput } from "./pipeline-runner";

/**
 * Bridges provider-neutral realtime pipeline output into avatar speaking state.
 * Audio output is authoritative: speaking starts on the first emitted audio frame
 * and ends only when the realtime response is completed or aborted.
 */
export class AvatarRealtimeBridge {
  constructor(private readonly avatar: AvatarRuntime) {}

  handleOutput(output: PipelineOutput): void {
    switch (output.type) {
      case "tts_audio":
        if (output.frame) this.avatar.setSpeaking(true);
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
