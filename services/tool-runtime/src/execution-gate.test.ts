import { describe, expect, it } from "vitest";
import type {
  CapabilityDefinition,
  CapabilityInvocation,
} from "../../../packages/protocol/src/capabilities";
import type { DeviceIdentity } from "../../../packages/protocol/src/identity";
import { checkExecutionGate } from "./execution-gate";

const device: DeviceIdentity = {
  deviceId: "desktop-1",
  userId: "user-1",
  runtime: "desktop",
};

const capability: CapabilityDefinition = {
  id: "filesystem.write",
  description: "Write a file",
  inputSchema: {},
  outputSchema: {},
  risk: "L2",
  requiredPermissions: ["filesystem.write"],
  supportedRuntimes: ["desktop"],
};

const baseInvocation: CapabilityInvocation = {
  id: "inv-1",
  capabilityId: capability.id,
  userId: "user-1",
  deviceId: "desktop-1",
  input: {},
  requestedBy: "agent",
};

const baseContext = {
  device,
  permission: {
    autonomy: 2 as const,
    grantedPermissions: [],
    deviceId: "desktop-1",
    devicePermissions: { "desktop-1": ["filesystem.write"] },
    approvalGranted: true,
  },
};

describe("capability identity binding", () => {
  it("rejects an invocation for a different capability", () => {
    expect(
      checkExecutionGate(
        capability,
        { ...baseInvocation, capabilityId: "filesystem.read" },
        baseContext,
      ),
    ).toEqual({
      allowed: false,
      reason: "capability_identity_mismatch",
    });
  });
});

describe("tool execution gate", () => {
  it("allows a fully authorized invocation", () => {
    expect(checkExecutionGate(capability, baseInvocation, baseContext)).toEqual({
      allowed: true,
    });
  });

  it("rejects a cross-user invocation before permission checks", () => {
    expect(
      checkExecutionGate(
        capability,
        { ...baseInvocation, userId: "user-2" },
        baseContext,
      ),
    ).toEqual({ allowed: false, reason: "user_identity_mismatch" });
  });

  it("rejects an unsupported runtime", () => {
    expect(
      checkExecutionGate(
        capability,
        baseInvocation,
        {
          ...baseContext,
          device: { ...device, runtime: "ios" },
          permission: { ...baseContext.permission, deviceId: "desktop-1" },
        },
      ),
    ).toEqual({ allowed: false, reason: "runtime_not_supported" });
  });

  it("rejects missing permissions", () => {
    expect(
      checkExecutionGate(
        capability,
        baseInvocation,
        {
          ...baseContext,
          permission: {
            ...baseContext.permission,
            devicePermissions: { "desktop-1": [] },
          },
        },
      ),
    ).toEqual({
      allowed: false,
      reason: "missing_permission:filesystem.write",
    });
  });
});
