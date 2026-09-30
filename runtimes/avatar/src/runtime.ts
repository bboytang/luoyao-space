import type { AvatarEmotionEventData } from "../../../packages/protocol/src/avatar";

export type AvatarActivity = "idle" | "listening" | "thinking" | "speaking";

export interface AvatarState {
  emotion: AvatarEmotionEventData["emotion"];
  intensity: number;
  expression: AvatarEmotionEventData["expression"];
  activity: AvatarActivity;
  speaking: boolean;
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
    this.state = {
      emotion: "calm",
      intensity: 0,
      expression: "neutral",
      activity: "idle",
      speaking: false,
      updatedAt: this.clock(),
    };
    this.renderer.render(this.state);
  }

  getState(): Readonly<AvatarState> { return this.state; }

  applyEmotion(event: AvatarEmotionEventData): Readonly<AvatarState> {
    this.state = { ...this.state, emotion: event.emotion, intensity: event.intensity, expression: event.expression, updatedAt: this.clock() };
    this.renderer.render(this.state);
    return this.state;
  }

  setActivity(activity: AvatarActivity): Readonly<AvatarState> {
    this.state = { ...this.state, activity, speaking: activity === "speaking", updatedAt: this.clock() };
    this.renderer.render(this.state);
    return this.state;
  }

  setSpeaking(speaking: boolean): Readonly<AvatarState> {
    this.state = {
      ...this.state,
      speaking,
      activity: speaking ? "speaking" : this.state.activity === "speaking" ? "idle" : this.state.activity,
      updatedAt: this.clock(),
    };
    this.renderer.render(this.state);
    return this.state;
  }

  dispose(): void { this.renderer.dispose?.(); }
}
