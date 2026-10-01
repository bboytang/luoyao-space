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

  it("round-trips v2 device admission framing without inventing a second contract", () => {
    const hello = {
      type: "device.hello" as const, protocolVersions: [2],
      device: { deviceId: "iot-1", platform: "iot" as const },
      supportedCapabilities: [], availableCapabilities: [],
    };
    expect(JSON.parse(jsonCodec.encodeControl(hello))).toEqual(hello);
    expect(jsonCodec.decodeControl(JSON.stringify({
      type: "device.accepted", version: 2, transportSessionId: "t-1",
      ownerConnectionId: "c-1", negotiatedCapabilities: [],
    }))).toMatchObject({ type: "device.accepted", transportSessionId: "t-1" });
    expect(jsonCodec.decodeControl(JSON.stringify({
      type: "device.rejected", reason: "unsupported_version", supportedVersions: [2],
    }))).toMatchObject({ type: "device.rejected", reason: "unsupported_version" });
  });
});
