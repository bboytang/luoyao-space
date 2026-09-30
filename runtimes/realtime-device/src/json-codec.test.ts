import { describe, expect, it } from "vitest";
import { jsonCodec } from "./json-codec";
import { TransportProtocolError } from "./transport";

describe("jsonCodec", () => {
  it("decodes a valid server message", () => {
    expect(
      jsonCodec.decodeControl(JSON.stringify({
        type: "ready",
        sessionId: "session-1",
        state: "ready",
        serverTime: "2026-01-01T00:00:00.000Z",
      })),
    ).toEqual({
      type: "ready",
      sessionId: "session-1",
      state: "ready",
      serverTime: "2026-01-01T00:00:00.000Z",
    });
  });

  it("rejects malformed JSON", () => {
    expect(() => jsonCodec.decodeControl("{")).toThrow(TransportProtocolError);
  });

  it("rejects unknown message types", () => {
    expect(() => jsonCodec.decodeControl(JSON.stringify({ type: "unknown" }))).toThrow(
      TransportProtocolError,
    );
  });

  it("rejects client-only control messages", () => {
    expect(() =>
      jsonCodec.decodeControl(JSON.stringify({ type: "listen", mode: "start" })),
    ).toThrow(TransportProtocolError);
  });

  it("encodes a client control message", () => {
    const message = { type: "listen", mode: "start" } as const;
    expect(JSON.parse(jsonCodec.encodeControl(message))).toEqual(message);
  });
});
