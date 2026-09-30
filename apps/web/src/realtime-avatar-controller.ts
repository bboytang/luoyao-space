import { AvatarRuntime } from "../../../runtimes/avatar/src/runtime";
import type { RealtimeServerMessage } from "../../../runtimes/realtime-device/src/protocol";

export interface RealtimeAvatarControllerOptions {
  avatar: AvatarRuntime;
}

/**
 * Keeps browser avatar presentation synchronized with provider-neutral realtime
 * control messages. Audio playback remains an injected browser concern.
 */
export class RealtimeAvatarController {
  private readonly avatar: AvatarRuntime;
  private ttsEnded = false;
  private playbackEpoch = 0;

  constructor(options: RealtimeAvatarControllerOptions) {
    this.avatar = options.avatar;
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
          this.ttsEnded = false;
          this.playbackEpoch += 1;
          this.avatar.setSpeaking(true);
        } else if (message.state === "stop") {
          this.ttsEnded = true;
        }
        break;
      case "error":
        this.ttsEnded = true;
        this.playbackEpoch += 1;
        this.avatar.setSpeaking(false);
        this.avatar.setActivity("idle");
        break;
      case "pong":
        break;
    }
  }

  handleAudioFrame(): void {
    this.playbackEpoch += 1;
    this.avatar.setSpeaking(true);
  }

  getPlaybackEpoch(): number {
    return this.playbackEpoch;
  }

  handlePlaybackIdle(epoch: number): void {
    if (epoch === this.playbackEpoch && this.ttsEnded) {
      this.avatar.setSpeaking(false);
    }
  }

  handleClosed(): void {
    this.ttsEnded = true;
    this.playbackEpoch += 1;
    this.avatar.setSpeaking(false);
    this.avatar.setActivity("idle");
  }
}
