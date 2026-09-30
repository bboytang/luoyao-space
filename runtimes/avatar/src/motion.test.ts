import { describe, expect, it } from "vitest";
import { toAvatarMotion } from "./motion";
import type { AvatarRenderModel } from "./render-model";

const model = (gesture: AvatarRenderModel["gesture"]): AvatarRenderModel => ({
  expression: "neutral", emotion: "calm", emotionIntensity: 0, activity: "idle", mouthOpen: 0, speaking: false,
  gaze: { x: 0, y: 0 }, gesture,
});

describe("toAvatarMotion", () => {
  it("gives listening and thinking distinct body cues", () => {
    expect(toAvatarMotion(model("listen"))).toMatchObject({ headTilt: 0.08, bodyRotation: -0.01 });
    expect(toAvatarMotion(model("think"))).toMatchObject({ headTilt: 0.06, bodyRotation: 0.015 });
  });

  it("animates speech and playful gestures from a phase", () => {
    const speech = toAvatarMotion(model("speak"), 0.25);
    const playful = toAvatarMotion(model("playful"), 0.25);
    expect(speech.gesturePhase).toBeCloseTo(1);
    expect(speech.gestureScale).toBeGreaterThan(1);
    expect(Math.abs(playful.headTilt)).toBeGreaterThan(Math.abs(speech.headTilt));
  });
});
