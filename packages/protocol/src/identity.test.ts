import { describe, expect, it } from "vitest";
import type { DeviceIdentity } from "./identity";

describe("DeviceIdentity", () => {
  it("uses Luoyao-owned runtime identifiers", () => {
    const device: DeviceIdentity = {
      deviceId: "device-1",
      userId: "user-1",
      runtime: "iot",
    };

    expect(device.runtime).toBe("iot");
  });
});
