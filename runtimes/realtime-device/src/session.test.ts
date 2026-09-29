import { describe, expect, it } from "vitest";
import {
  InvalidSessionTransitionError,
  RealtimeSession,
} from "./session";

describe("RealtimeSession", () => {
  it("accepts the normal listen and speech lifecycle", () => {
    const session = new RealtimeSession("session-1", "device-1");

    expect(session.state).toBe("connecting");
    expect(session.transition("hello")).toBe("ready");
    expect(session.transition("listen_start")).toBe("listening");
    expect(session.transition("listen_stop")).toBe("processing");
    expect(session.transition("speech_start")).toBe("speaking");
    expect(session.transition("speech_stop")).toBe("ready");
  });

  it("supports barge-in while speaking", () => {
    const session = new RealtimeSession("session-2");

    session.transition("hello");
    session.transition("listen_start");
    session.transition("listen_stop");
    session.transition("speech_start");

    expect(session.transition("abort")).toBe("aborting");
    expect(session.transition("abort_complete")).toBe("ready");
    expect(session.transition("listen_start")).toBe("listening");
  });

  it("does not start a new listen cycle before abort cleanup completes", () => {
    const session = new RealtimeSession("session-3a");

    session.transition("hello");
    session.transition("listen_start");
    session.transition("listen_stop");
    session.transition("speech_start");
    session.transition("abort");

    expect(() => session.transition("listen_start")).toThrow(
      InvalidSessionTransitionError,
    );
    expect(session.transition("abort_complete")).toBe("ready");
  });

  it("rejects invalid transitions", () => {
    const session = new RealtimeSession("session-3");

    expect(() => session.transition("speech_start")).toThrow(
      InvalidSessionTransitionError,
    );
  });

  it("closes cleanly", () => {
    const session = new RealtimeSession("session-4");

    expect(session.transition("hello")).toBe("ready");
    expect(session.transition("close")).toBe("closing");
    expect(session.transition("closed")).toBe("closed");
  });
});
