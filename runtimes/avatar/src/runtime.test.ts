import { describe, expect, it } from "vitest";
import { AvatarRuntime, type AvatarRenderer } from "./runtime";
import type { AvatarEmotionEvent } from "../../../packages/protocol/src/events";

function renderer() {
  const states: unknown[] = [];
  const value: AvatarRenderer = { render: (state) => states.push({ ...state }) };
  return { value, states };
}

const emotionEvent: AvatarEmotionEvent = {
  id: "evt-1", type: "avatar.emotion", version: 1, occurredAt: "2026-09-30T00:00:00.000Z",
  userId: "user-1", companionId: "luoyao", source: "conversation-director",
  data: { emotion: "warm", intensity: 0.8, expression: "soft_smile", transitionMs: 300 },
};

describe("AvatarRuntime", () => {
  it("starts in a calm idle state", () => {
    const r = renderer();
    const runtime = new AvatarRuntime({ renderer: r.value, clock: () => 100 });
    expect(runtime.getState()).toMatchObject({ emotion: "calm", expression: "neutral", activity: "idle", speaking: false, updatedAt: 100 });
  });

  it("consumes avatar.emotion domain events", () => {
    const r = renderer();
    const runtime = new AvatarRuntime({ renderer: r.value, clock: () => 200 });
    runtime.handleEvent(emotionEvent);
    expect(runtime.getState()).toMatchObject({ emotion: "warm", intensity: 0.8, expression: "soft_smile", updatedAt: 200 });
    expect(runtime.getState().activity).toBe("idle");
  });

  it("keeps speaking independent from emotion", () => {
    const r = renderer();
    const runtime = new AvatarRuntime({ renderer: r.value, clock: () => 300 });
    runtime.handleEvent({ ...emotionEvent, data: { emotion: "playful", intensity: 0.7, expression: "playful" } });
    runtime.setSpeaking(true);
    expect(runtime.getState()).toMatchObject({ emotion: "playful", expression: "playful", activity: "speaking", speaking: true });
    runtime.setSpeaking(false);
    expect(runtime.getState().speaking).toBe(false);
  });
});
