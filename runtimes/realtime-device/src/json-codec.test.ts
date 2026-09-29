import { describe, expect, it } from "vitest";
import { jsonCodec } from "./json-codec";
import { TransportProtocolError } from "./transport";

describe("jsonCodec", () => {
  it("decodes a valid hello message", () => {
    expect(
      jsonCodec.decodeControl(
        JSON.stringify({
          type: "hello",
          version: 1,
          sessionId: "session-1",
          deviceId: "device-1",
          capabilities: ["audio"],
        }),
      ),
    ).toEqual({
      type: "hello",
      version: 1,
      sessionId: "session-1",
      deviceId: "device-1",
      capabilities: ["audio"],
    });
  });

  it("rejects malformed JSON", () => {
    expect(() => jsonCodec.decodeControl("{")).toThrow(
      TransportProtocolError,
    );
  });

  it("rejects unknown message types", () => {
    expect(() =>
      jsonCodec.decodeControl(JSON.stringify({ type: "unknown" })),
    ).toThrow(TransportProtocolError);
  });

  it("rejects invalid listen modes", () => {
    expect(() =>
      jsonCodec.decodeControl(
        JSON.stringify({ type: "listen", mode: "pause" }),
      ),
    ).toThrow(TransportProtocolError);
  });

  it("rejects invalid abort reasons", () => {
    expect(() =>
      jsonCodec.decodeControl(
        JSON.stringify({ type: "abort", reason: "unknown" }),
      ),
    ).toThrow(TransportProtocolError);
  });

  it("round-trips a server message", () => {
    const message = {
      type: "tts",
      state: "sentence_start",
      messageId: "message-1",
      sentence: "你好",
      index: 0,
    } as const;

    expect(JSON.parse(jsonCodec.encodeControl(message))).toEqual(message);
  });
});
