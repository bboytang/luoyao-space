import { describe, expect, it } from "vitest";
import { jsonCodec } from "./json-codec";
import { TransportProtocolError } from "./transport";

describe("jsonCodec", () => {
  it("decodes a valid server message", () => {
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

  it("rejects client-only control messages", () => {
    expect(() =>
      jsonCodec.decodeControl(
        JSON.stringify({ type: "listen", mode: "start" }),
      ),
    ).toThrow(TransportProtocolError);
  });

  it("rejects unknown server messages", () => {
    expect(() =>
      jsonCodec.decodeControl(
        JSON.stringify({ type: "abort", reason: "unknown" }),
      ),
    ).toThrow(TransportProtocolError);
  });

  it("round-trips a client control message", () => {
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
