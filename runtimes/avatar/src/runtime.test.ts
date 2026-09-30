import { describe, expect, it } from "vitest";
import { AvatarRuntime, type AvatarRenderer } from "./runtime";

function renderer() {
  const states: unknown[] = [];
  const value: AvatarRenderer = { render: (state) => states.push({ ...state }) };
  return { value, states };
}

describe("AvatarRuntime", () => {
  it("starts in a calm idle state", () => {
    const r = renderer();
    const runtime = new AvatarRuntime({ renderer: r.value, clock: () => 100 });
    expect(runtime.getState()).toMatchObject({ emotion: "calm", expression: "neutral", activity: "idle", speaking: false, updatedAt: 100 });
    expect(r.states).toHaveLength(1);
  });

  it("applies provider-neutral emotion and expression state", () => {
    const r = renderer();
    const runtime = new AvatarRuntime({ renderer: r.value, clock: () => 200 });
    runtime.applyEmotion({ emotion: "warm", intensity: 0.8, expression: "soft_smile", transitionMs: 300 });
    expect(runtime.getState()).toMatchObject({ emotion: "warm", intensity: 0.8, expression: "soft_smile", updatedAt: 200 });
  });

  it("keeps speaking independent from emotion", () => {
    const r = renderer();
    const runtime = new AvatarRuntime({ renderer: r.value, clock: () => 300 });
    runtime.applyEmotion({ emotion: "playful", intensity: 0.7, expression: "playful" });
    runtime.setSpeaking(true);
    expect(runtime.getState()).toMatchObject({ emotion: "playful", expression: "playful", activity: "speaking", speaking: true });
    runtime.setSpeaking(false);
    expect(runtime.getState().speaking).toBe(false);
  });
});
