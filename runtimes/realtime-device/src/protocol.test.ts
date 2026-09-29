import { describe, expect, it } from "vitest";
import { isControlMessage } from "./protocol";

describe("realtime control messages", () => {
  it("accepts structurally valid control messages", () => {
    expect(
      isControlMessage({
        type: "hello",
        version: 1,
        sessionId: "session-1",
      }),
    ).toBe(true);
    expect(isControlMessage({ type: "listen", mode: "start" })).toBe(true);
    expect(isControlMessage({ type: "abort", reason: "barge_in" })).toBe(true);
    expect(
      isControlMessage({
        type: "ping",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("rejects incomplete or unsupported control messages", () => {
    expect(isControlMessage({ type: "hello" })).toBe(false);
    expect(isControlMessage({ type: "listen" })).toBe(false);
    expect(isControlMessage({ type: "abort", reason: "unknown" })).toBe(false);
    expect(isControlMessage({ type: "ping" })).toBe(false);
    expect(isControlMessage({ type: "unknown" })).toBe(false);
    expect(isControlMessage(null)).toBe(false);
  });
});
