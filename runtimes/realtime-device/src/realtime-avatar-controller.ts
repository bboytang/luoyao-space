import type { RealtimeServerMessage } from "./protocol";

export interface RealtimeAvatarStateController {
  setActivity(activity: "idle" | "listening" | "thinking" | "speaking"): void;
  setSpeaking(speaking: boolean): void;
}

/**
 * Maps provider-neutral realtime lifecycle events into avatar state changes.
 * Rendering and the concrete avatar runtime remain outside the realtime core.
 */
export class RealtimeAvatarController {
  private ttsEnded = false;
  private playbackEpoch = 0;

  constructor(private readonly avatar: RealtimeAvatarStateController) {}

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

  handleAborted(): void {
    this.ttsEnded = true;
    this.playbackEpoch += 1;
    this.avatar.setSpeaking(false);
    this.avatar.setActivity("idle");
  }

  handleClosed(): void {
    this.handleAborted();
  }
}
