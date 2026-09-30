import type { AvatarState } from "./runtime";

export interface AvatarRenderModel {
  expression: AvatarState["expression"];
  emotion: AvatarState["emotion"];
  emotionIntensity: number;
  activity: AvatarState["activity"];
  mouthOpen: number;
  speaking: boolean;
  gaze: { x: number; y: number };
  gesture: "none" | "listen" | "think" | "speak" | "warm" | "playful";
}

/** Maps domain avatar state into provider-neutral visual animation parameters. */
export function toAvatarRenderModel(state: Readonly<AvatarState>): AvatarRenderModel {
  const gesture = state.activity === "speaking"
    ? state.emotion === "playful" ? "playful" : "speak"
    : state.activity === "listening"
      ? "listen"
      : state.activity === "thinking"
        ? "think"
        : state.emotion === "warm" ? "warm" : "none";

  const gaze = state.activity === "listening"
    ? { x: 0, y: 0.04 }
    : state.activity === "thinking"
      ? { x: 0.08, y: 0.05 }
      : { x: 0, y: 0 };

  return {
    expression: state.expression,
    emotion: state.emotion,
    emotionIntensity: state.intensity,
    activity: state.activity,
    mouthOpen: state.mouthOpen,
    speaking: state.speaking,
    gaze,
    gesture,
  };
}
