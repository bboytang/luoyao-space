import { describe, expect, it } from "vitest";
import type { CapabilityDefinition, CapabilityInvocation } from "../../../packages/protocol/src/capabilities";
import { executeCapability } from "./runner";

const capability: CapabilityDefinition = {
  id: "filesystem.write",
  description: "Write a file",
  inputSchema: {},
  outputSchema: {},
  risk: "L2",
  requiredPermissions: ["filesystem.write"],
  supportedRuntimes: ["desktop"],
};

const invocation: CapabilityInvocation = {
  id: "inv-1",
  capabilityId: capability.id,
  userId: "user-1",
  deviceId: "desktop-1",
  input: { path: "/tmp/x" },
  requestedBy: "agent",
};

const context = {
  device: {
    deviceId: "desktop-1",
    userId: "user-1",
    runtime: "desktop" as const,
  },
  permission: {
    autonomy: 2 as const,
    grantedPermissions: [],
    deviceId: "desktop-1",
    devicePermissions: { "desktop-1": ["filesystem.write"] },
    approvalGranted: true,
  },
  backend: {
    execute: async () => ({ written: true }),
  },
};

describe("tool execution runner", () => {
  it("executes the backend only after the gate allows", async () => {
    const result = await executeCapability(capability, invocation, context);
    expect(result).toEqual({
      invocationId: "inv-1",
      ok: true,
      output: { written: true },
    });
  });

  it("does not call the backend when authorization fails", async () => {
    let calls = 0;

    const result = await executeCapability(
      capability,
      { ...invocation, userId: "user-2" },
      {
        ...context,
        backend: {
          execute: async () => {
            calls += 1;
            return {};
          },
        },
      },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("EXECUTION_DENIED");
    expect(calls).toBe(0);
  });

  it("converts backend failures into a capability result", async () => {
    const result = await executeCapability(
      capability,
      invocation,
      {
        ...context,
        backend: {
          execute: async () => {
            throw new Error("backend unavailable");
          },
        },
      },
    );

    expect(result).toEqual({
      invocationId: "inv-1",
      ok: false,
      error: {
        code: "BACKEND_EXECUTION_FAILED",
        message: "backend unavailable",
      },
    });
  });
});
