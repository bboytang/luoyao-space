import type { AvatarEmotionEventData } from "../../../packages/protocol/src/avatar";
import type { AvatarEmotionEvent } from "../../../packages/protocol/src/events";

export type AvatarActivity = "idle" | "listening" | "thinking" | "speaking";

export interface AvatarState {
  emotion: AvatarEmotionEventData["emotion"];
  intensity: number;
  expression: AvatarEmotionEventData["expression"];
  activity: AvatarActivity;
  speaking: boolean;
  mouthOpen: number;
  updatedAt: number;
}

export interface AvatarRenderer {
  render(state: Readonly<AvatarState>): void;
  dispose?(): void;
}

export interface AvatarRuntimeOptions {
  renderer: AvatarRenderer;
  clock?: () => number;
}

export class AvatarRuntime {
  private readonly renderer: AvatarRenderer;
  private readonly clock: () => number;
  private state: AvatarState;

  constructor(options: AvatarRuntimeOptions) {
    this.renderer = options.renderer;
    this.clock = options.clock ?? Date.now;
    this.state = { emotion: "calm", intensity: 0, expression: "neutral", activity: "idle", speaking: false, updatedAt: this.clock() };
    this.renderer.render(this.state);
  }

  getState(): Readonly<AvatarState> { return this.state; }

  applyEmotion(event: AvatarEmotionEventData): Readonly<AvatarState> {
    this.state = { ...this.state, emotion: event.emotion, intensity: event.intensity, expression: event.expression, updatedAt: this.clock() };
    this.renderer.render(this.state);
    return this.state;
  }

  handleEvent(event: AvatarEmotionEvent): Readonly<AvatarState> {
    if (event.type !== "avatar.emotion") return this.state;
    return this.applyEmotion(event.data);
  }

  setActivity(activity: AvatarActivity): Readonly<AvatarState> {
    this.state = { ...this.state, activity, speaking: activity === "speaking", updatedAt: this.clock() };
    this.renderer.render(this.state);
    return this.state;
  }

  setMouthOpen(mouthOpen: number): Readonly<AvatarState> {
    const normalized = Number.isFinite(mouthOpen) ? Math.min(1, Math.max(0, mouthOpen)) : 0;
    this.state = { ...this.state, mouthOpen: normalized, updatedAt: this.clock() };
    this.renderer.render(this.state);
    return this.state;
  }

  setSpeaking(speaking: boolean): Readonly<AvatarState> {
    this.state = { ...this.state, speaking, mouthOpen: speaking ? this.state.mouthOpen : 0, activity: speaking ? "speaking" : this.state.activity === "speaking" ? "idle" : this.state.activity, updatedAt: this.clock() };
    this.renderer.render(this.state);
    return this.state;
  }

  dispose(): void { this.renderer.dispose?.(); }
}
