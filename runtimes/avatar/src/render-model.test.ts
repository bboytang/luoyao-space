import { describe, expect, it } from "vitest";
import { toAvatarRenderModel } from "./render-model";
import type { AvatarState } from "./runtime";

const base: AvatarState = {
  emotion: "calm", intensity: 0, expression: "neutral", activity: "idle", speaking: false, mouthOpen: 0, updatedAt: 1,
};

describe("toAvatarRenderModel", () => {
  it("maps speaking state to a speaking gesture and preserves mouth openness", () => {
    const model = toAvatarRenderModel({ ...base, emotion: "warm", expression: "soft_smile", activity: "speaking", speaking: true, mouthOpen: 0.7 });
    expect(model).toMatchObject({ gesture: "speak", speaking: true, mouthOpen: 0.7, emotion: "warm" });
  });

  it("maps listening and thinking into distinct gaze/activity parameters", () => {
    expect(toAvatarRenderModel({ ...base, activity: "listening" })).toMatchObject({ gesture: "listen", gaze: { x: 0, y: 0.04 } });
    expect(toAvatarRenderModel({ ...base, activity: "thinking" })).toMatchObject({ gesture: "think", gaze: { x: 0.08, y: 0.05 } });
  });

  it("layers playful emotion over speaking", () => {
    expect(toAvatarRenderModel({ ...base, emotion: "playful", activity: "speaking", speaking: true })).toMatchObject({ gesture: "playful", emotion: "playful" });
  });
});
