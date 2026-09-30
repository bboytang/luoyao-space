import { describe, expect, it } from "vitest";
import { isAvatarEmotionEventData } from "./avatar";

describe("avatar emotion protocol", () => {
  it("accepts a valid expression event", () => {
    expect(
      isAvatarEmotionEventData({
        emotion: "warm",
        intensity: 0.7,
        expression: "soft_smile",
        transitionMs: 240,
      }),
    ).toBe(true);
  });

  it("rejects intensity outside the runtime contract", () => {
    expect(
      isAvatarEmotionEventData({
        emotion: "warm",
        intensity: 1.1,
        expression: "soft_smile",
      }),
    ).toBe(false);
  });

  it("rejects unknown emotions and expressions", () => {
    expect(
      isAvatarEmotionEventData({
        emotion: "excited",
        intensity: 0.5,
        expression: "wink",
      }),
    ).toBe(false);
  });

  it("rejects invalid transition durations", () => {
    expect(
      isAvatarEmotionEventData({
        emotion: "calm",
        intensity: 0.2,
        expression: "neutral",
        transitionMs: -1,
      }),
    ).toBe(false);
  });
});
