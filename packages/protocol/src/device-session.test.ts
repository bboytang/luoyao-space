import { describe, expect, it } from "vitest";
import { isV2Platform, negotiateDeviceSession, type DeviceSessionHelloV2 } from "./device-session";
import * as protocol from "./index";
import { isCapabilitySupportedOnDevice } from "./capabilities";
import type { DeviceIdentity } from "./identity";

const platforms = ["ios", "windows", "android", "macos", "iot", "web"] as const;
const audioInput = {
  id: "audio.input" as const,
  formats: [{ codec: "pcm_s16le" as const, sampleRateHz: 16_000, channels: 1 }],
};

function hello(overrides: Partial<DeviceSessionHelloV2> = {}): DeviceSessionHelloV2 {
  return {
    type: "device.hello",
    protocolVersions: [2],
    device: { deviceId: "device-1", platform: "ios" },
    supportedCapabilities: [],
    availableCapabilities: [],
    ...overrides,
  };
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    principal: { userId: "user-1" },
    authorizedDevice: { deviceId: "device-1", userId: "user-1" },
    transportSessionId: "transport-1",
    connectionId: "connection-1",
    serverCapabilities: [],
    ...overrides,
  };
}

describe("device session v2 contract", () => {
  it("exposes the v2 contract from the shared protocol package", () => {
    expect(protocol.isV2Platform("ios")).toBe(true);
    expect(protocol.negotiateDeviceSession).toBe(negotiateDeviceSession);
  });

  it.each(platforms)("accepts canonical platform %s without requiring any presentation or audio capability", (platform) => {
    expect(isV2Platform(platform)).toBe(true);
    expect(negotiateDeviceSession(hello({ device: { deviceId: "device-1", platform } }), context())).toMatchObject({
      type: "device.accepted",
      version: 2,
      negotiatedCapabilities: [],
    });
  });

  it("keeps legacy desktop readable without emitting it in a v2 identity", () => {
    const legacy: DeviceIdentity = { deviceId: "old-desktop", userId: "user-1", runtime: "desktop" };
    expect(isCapabilitySupportedOnDevice({
      id: "filesystem.write", description: "write", inputSchema: {}, outputSchema: {},
      risk: "L2", requiredPermissions: [], supportedRuntimes: ["desktop"],
    }, legacy)).toBe(true);
    expect(isV2Platform("desktop")).toBe(false);
    expect(negotiateDeviceSession(hello({ device: { deviceId: "device-1", platform: "desktop" as "ios" } }), context())).toMatchObject({
      type: "device.rejected", reason: "invalid_hello",
    });
  });

  it("accepts no-screen IoT and a no-avatar device with audio capability", () => {
    const result = negotiateDeviceSession(hello({
      device: { deviceId: "device-1", platform: "iot" },
      supportedCapabilities: [audioInput], availableCapabilities: [audioInput],
    }), context({ serverCapabilities: [audioInput] }));
    expect(result).toMatchObject({
      type: "device.accepted",
      negotiatedCapabilities: [{ id: "audio.input", format: audioInput.formats[0] }],
    });
  });

  it("does not negotiate a supported capability that is currently unavailable", () => {
    expect(negotiateDeviceSession(hello({
      supportedCapabilities: [audioInput], availableCapabilities: [],
    }), context({ serverCapabilities: [audioInput] }))).toMatchObject({
      type: "device.accepted", negotiatedCapabilities: [],
    });
  });

  it("selects a mutually available audio format in server preference order", () => {
    const opus = { codec: "opus" as const, sampleRateHz: 48_000, channels: 1 };
    const clientAudio = { id: "audio.output" as const, formats: [audioInput.formats[0], opus] };
    const serverAudio = { id: "audio.output" as const, formats: [opus, audioInput.formats[0]] };
    expect(negotiateDeviceSession(hello({
      supportedCapabilities: [clientAudio], availableCapabilities: [clientAudio],
    }), context({ serverCapabilities: [serverAudio] }))).toMatchObject({
      type: "device.accepted",
      negotiatedCapabilities: [{ id: "audio.output", format: opus }],
    });
  });

  it("selects v2 from a mixed version proposal without applying v1 semantics", () => {
    expect(negotiateDeviceSession(hello({ protocolVersions: [1, 2] }), context())).toMatchObject({
      type: "device.accepted", version: 2,
    });
  });

  it("omits audio when there is no mutually available format", () => {
    const opusOnly = {
      id: "audio.input" as const,
      formats: [{ codec: "opus" as const, sampleRateHz: 48_000, channels: 1 }],
    };
    expect(negotiateDeviceSession(hello({
      supportedCapabilities: [audioInput], availableCapabilities: [audioInput],
    }), context({ serverCapabilities: [opusOnly] }))).toMatchObject({
      type: "device.accepted", negotiatedCapabilities: [],
    });
  });

  it("rejects unsupported protocol proposals with a machine-readable reason", () => {
    expect(negotiateDeviceSession(hello({ protocolVersions: [3, 1] }), context())).toEqual({
      type: "device.rejected", reason: "unsupported_version", supportedVersions: [2],
    });
  });

  it("rejects missing required proposal, identity, availability, or audio format information", () => {
    for (const invalid of [
      { ...hello(), protocolVersions: [] },
      { ...hello(), device: { deviceId: "", platform: "ios" } },
      { ...hello(), availableCapabilities: undefined },
      { ...hello(), supportedCapabilities: [{ id: "audio.input", formats: [] }], availableCapabilities: [] },
      { ...hello(), supportedCapabilities: [], availableCapabilities: [audioInput] },
    ]) {
      expect(negotiateDeviceSession(invalid, context())).toMatchObject({ type: "device.rejected" });
    }
    expect(negotiateDeviceSession({
      ...hello(), supportedCapabilities: [{ id: "audio.input", formats: [] }],
    }, context())).toMatchObject({
      type: "device.rejected", reason: "missing_negotiation_information",
    });
  });

  it("does not treat a platform name as a capability", () => {
    expect(negotiateDeviceSession(hello({ supportedCapabilities: [{ id: "ios" } as never] }), context())).toMatchObject({
      type: "device.rejected", reason: "invalid_hello",
    });
  });

  it("does not authenticate a client from its declared device ID or capabilities", () => {
    const claim = hello({ supportedCapabilities: [audioInput], availableCapabilities: [audioInput] });
    expect(negotiateDeviceSession(claim, context({ principal: undefined }))).toMatchObject({
      type: "device.rejected", reason: "missing_trusted_identity",
    });
    expect(negotiateDeviceSession(claim, context({ authorizedDevice: undefined }))).toMatchObject({
      type: "device.rejected", reason: "missing_trusted_identity",
    });
    expect(negotiateDeviceSession(claim, context({ authorizedDevice: { deviceId: "other", userId: "user-1" } }))).toMatchObject({
      type: "device.rejected", reason: "device_identity_mismatch",
    });
  });

  it("rejects duplicate active ownership and requires a new transport session after disconnect", () => {
    expect(negotiateDeviceSession(hello(), context({
      activeOwner: { transportSessionId: "transport-1", connectionId: "connection-other", state: "active" },
    }))).toMatchObject({ type: "device.rejected", reason: "ownership_conflict" });
    expect(negotiateDeviceSession(hello(), context({
      activeOwner: { transportSessionId: "transport-1", connectionId: "connection-other", state: "ended" },
    }))).toMatchObject({ type: "device.rejected", reason: "transport_session_ended" });
    expect(negotiateDeviceSession(hello(), context({
      transportSessionId: "transport-2",
      activeOwner: { transportSessionId: "transport-1", connectionId: "connection-other", state: "ended" },
    }))).toMatchObject({ type: "device.accepted", transportSessionId: "transport-2" });
  });
});
