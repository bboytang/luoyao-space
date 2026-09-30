import { AvatarRuntime } from "../../../runtimes/avatar/src/runtime";
import type { AudioFrame, RealtimeServerMessage } from "../../../runtimes/realtime-device/src/protocol";

export interface RealtimeAvatarControllerOptions {
  avatar: AvatarRuntime;
  onAudio?: (frame: AudioFrame) => void;
}

/**
 * Keeps browser avatar presentation synchronized with provider-neutral realtime
 * control messages. Audio playback remains an injected browser concern.
 */
export class RealtimeAvatarController {
  private readonly avatar: AvatarRuntime;
  private readonly onAudio?: (frame: AudioFrame) => void;

  constructor(options: RealtimeAvatarControllerOptions) {
    this.avatar = options.avatar;
    this.onAudio = options.onAudio;
  }

  handleServerMessage(message: RealtimeServerMessage): void {
    switch (message.type) {
      case "ready":
        this.avatar.setActivity("idle");
        break;
      case "stt":
        this.avatar.setActivity(message.final ? "thinking" : "listening");
        break;
      case "tts":
        if (message.state === "start" || message.state === "sentence_start") {
          this.avatar.setSpeaking(true);
        } else {
          this.avatar.setSpeaking(false);
        }
        break;
      case "error":
        this.avatar.setSpeaking(false);
        this.avatar.setActivity("idle");
        break;
      case "pong":
        break;
    }
  }

  handleAudioFrame(frame: AudioFrame): void {
    this.avatar.setSpeaking(true);
    this.onAudio?.(frame);
  }

  handleClosed(): void {
    this.avatar.setSpeaking(false);
    this.avatar.setActivity("idle");
  }
}
