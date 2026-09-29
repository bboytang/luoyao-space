import { describe, expect, it } from "vitest";
import { isCapabilitySupportedOnDevice, isInvocationBoundToUserDevice, type CapabilityDefinition } from "./capabilities";
import type { DeviceIdentity } from "./identity";

const capability: CapabilityDefinition = {
  id: "filesystem.write",
  description: "Write a file",
  inputSchema: {},
  outputSchema: {},
  risk: "L2",
  requiredPermissions: ["filesystem.write"],
  supportedRuntimes: ["desktop"],
};

describe("capability runtime compatibility", () => {
  it("allows a capability on a supported device runtime", () => {
    const device: DeviceIdentity = {
      deviceId: "desktop-1",
      userId: "user-1",
      runtime: "desktop",
    };

    expect(isCapabilitySupportedOnDevice(capability, device)).toBe(true);
  });

  it("rejects a capability on an unsupported device runtime", () => {
    const device: DeviceIdentity = {
      deviceId: "iphone-1",
      userId: "user-1",
      runtime: "ios",
    };

    expect(isCapabilitySupportedOnDevice(capability, device)).toBe(false);
  });
});


describe("capability invocation identity binding", () => {
  const device: DeviceIdentity = {
    deviceId: "desktop-1",
    userId: "user-1",
    runtime: "desktop",
  };

  it("accepts an invocation for the same user and device", () => {
    expect(
      isInvocationBoundToUserDevice(
        {
          id: "inv-1",
          capabilityId: capability.id,
          userId: "user-1",
          deviceId: "desktop-1",
          input: {},
          requestedBy: "agent",
        },
        device,
      ),
    ).toBe(true);
  });

  it("rejects an invocation that targets another user's device", () => {
    expect(
      isInvocationBoundToUserDevice(
        {
          id: "inv-2",
          capabilityId: capability.id,
          userId: "user-2",
          deviceId: "desktop-1",
          input: {},
          requestedBy: "agent",
        },
        device,
      ),
    ).toBe(false);
  });

  it("rejects an invocation that names a different device", () => {
    expect(
      isInvocationBoundToUserDevice(
        {
          id: "inv-3",
          capabilityId: capability.id,
          userId: "user-1",
          deviceId: "desktop-2",
          input: {},
          requestedBy: "agent",
        },
        device,
      ),
    ).toBe(false);
  });

  it("allows a user-bound invocation without a target device", () => {
    expect(
      isInvocationBoundToUserDevice(
        {
          id: "inv-4",
          capabilityId: capability.id,
          userId: "user-1",
          input: {},
          requestedBy: "agent",
        },
        device,
      ),
    ).toBe(true);
  });
});
