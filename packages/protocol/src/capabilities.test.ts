import { describe, expect, it } from "vitest";
import { isCapabilitySupportedOnDevice, type CapabilityDefinition } from "./capabilities";
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
