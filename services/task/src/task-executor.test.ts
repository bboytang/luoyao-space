import { describe, expect, it } from "vitest";
import type { AgentTask } from "../../../packages/protocol/src/tasks";
import type { CapabilityDefinition } from "../../../packages/protocol/src/capabilities";
import { executeTaskStep } from "./task-executor";

const capability: CapabilityDefinition = {
  id: "filesystem.write",
  description: "Write a file",
  inputSchema: {},
  outputSchema: {},
  risk: "L2",
  requiredPermissions: ["filesystem.write"],
  supportedRuntimes: ["desktop"],
};

const device = {
  deviceId: "desktop-1",
  userId: "user-1",
  runtime: "desktop" as const,
};

const taskBase: AgentTask = {
  taskId: "task-1",
  userId: "user-1",
  companionId: "luoyao",
  goal: "修改项目",
  status: "RUNNING",
  plan: [{
    id: "step-1",
    capabilityId: "filesystem.write",
    description: "写文件",
    risk: "L2",
    requiredPermissions: ["filesystem.write"],
    requiresApproval: true,
    input: { path: "README.md" },
  }],
  currentStep: 0,
  requiresApproval: true,
  approvalStatus: "APPROVED",
  deviceId: "desktop-1",
  createdAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T00:00:00.000Z",
};

const permission = {
  autonomy: 2 as const,
  grantedPermissions: [],
  deviceId: "desktop-1",
  devicePermissions: { "desktop-1": ["filesystem.write"] },
  approvalGranted: true,
};

describe("executeTaskStep", () => {
  it("creates an agent invocation and routes it through the execution gate", async () => {
    let received: unknown;

    const result = await executeTaskStep({
      task: taskBase,
      capability,
      device,
      permission,
      invocationId: "inv-1",
      backend: {
        execute: async (invocation) => {
          received = invocation;
          return { written: true };
        },
      },
    });

    expect(result).toEqual({
      invocationId: "inv-1",
      ok: true,
      output: { written: true },
    });
    expect(received).toMatchObject({
      id: "inv-1",
      capabilityId: "filesystem.write",
      userId: "user-1",
      deviceId: "desktop-1",
      input: { path: "README.md" },
      requestedBy: "agent",
    });
  });

  it("does not execute a task that is waiting for approval", async () => {
    let calls = 0;
    const result = await executeTaskStep({
      task: { ...taskBase, status: "WAITING_APPROVAL", approvalStatus: "PENDING" },
      capability,
      device,
      permission,
      backend: {
        execute: async () => {
          calls += 1;
          return {};
        },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "TASK_EXECUTION_DENIED", message: "task_not_running" },
    });
    expect(calls).toBe(0);
  });

  it("does not execute when the plan capability differs", async () => {
    let calls = 0;
    const result = await executeTaskStep({
      task: taskBase,
      capability: { ...capability, id: "browser.open" },
      device,
      permission,
      backend: {
        execute: async () => {
          calls += 1;
          return {};
        },
      },
    });

    expect(result.error?.message).toBe("task_capability_mismatch");
    expect(calls).toBe(0);
  });

  it("does not execute on a different target device", async () => {
    let calls = 0;
    const result = await executeTaskStep({
      task: taskBase,
      capability,
      device: { ...device, deviceId: "desktop-2" },
      permission: { ...permission, deviceId: "desktop-2", devicePermissions: { "desktop-2": ["filesystem.write"] } },
      backend: {
        execute: async () => {
          calls += 1;
          return {};
        },
      },
    });

    expect(result.error?.message).toBe("task_device_mismatch");
    expect(calls).toBe(0);
  });

  it("still respects the execution gate when task-level checks pass", async () => {
    let calls = 0;
    const result = await executeTaskStep({
      task: taskBase,
      capability,
      device,
      permission: { ...permission, autonomy: 1 },
      backend: {
        execute: async () => {
          calls += 1;
          return {};
        },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "EXECUTION_DENIED", message: "autonomy_level_too_low" },
    });
    expect(calls).toBe(0);
  });

  it("does not execute an unapproved consequential step", async () => {
    let calls = 0;
    const result = await executeTaskStep({
      task: { ...taskBase, approvalStatus: "PENDING" },
      capability,
      device,
      permission,
      backend: {
        execute: async () => {
          calls += 1;
          return {};
        },
      },
    });

    expect(result.error?.message).toBe("task_step_approval_required");
    expect(calls).toBe(0);
  });
});
