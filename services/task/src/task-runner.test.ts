import { describe, expect, it } from "vitest";
import type { CapabilityDefinition } from "../../../packages/protocol/src/capabilities";
import type { AgentTask } from "../../../packages/protocol/src/tasks";
import { executeTask } from "./task-runner";

const capabilities: CapabilityDefinition[] = [
  {
    id: "filesystem.write",
    description: "Write a file",
    inputSchema: {},
    outputSchema: {},
    risk: "L1",
    requiredPermissions: ["filesystem.write"],
    supportedRuntimes: ["desktop"],
  },
  {
    id: "browser.open",
    description: "Open a page",
    inputSchema: {},
    outputSchema: {},
    risk: "L0",
    requiredPermissions: ["browser.read"],
    supportedRuntimes: ["desktop"],
  },
];

const device = {
  deviceId: "desktop-1",
  userId: "user-1",
  runtime: "desktop" as const,
};

const permission = {
  autonomy: 1 as const,
  grantedPermissions: [],
  deviceId: "desktop-1",
  devicePermissions: {
    "desktop-1": ["filesystem.write", "browser.read"],
  },
  approvalGranted: false,
};

const task: AgentTask = {
  taskId: "task-1",
  userId: "user-1",
  companionId: "luoyao",
  goal: "完成两个动作",
  status: "RUNNING",
  plan: [
    {
      id: "step-1",
      capabilityId: "filesystem.write",
      description: "写文件",
      risk: "L1",
      requiredPermissions: ["filesystem.write"],
      requiresApproval: false,
      input: { path: "a.txt" },
    },
    {
      id: "step-2",
      capabilityId: "browser.open",
      description: "打开页面",
      risk: "L0",
      requiredPermissions: ["browser.read"],
      requiresApproval: false,
      input: { url: "https://example.com" },
    },
  ],
  currentStep: 0,
  requiresApproval: false,
  deviceId: "desktop-1",
  createdAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T00:00:00.000Z",
};

const resolveCapability = (id: string) =>
  capabilities.find((capability) => capability.id === id);

describe("executeTask", () => {
  it("executes every step and completes the task", async () => {
    const invocations: string[] = [];

    const result = await executeTask({
      task,
      device,
      permission,
      resolveCapability,
      now: "2026-09-30T01:00:00.000Z",
      backend: {
        execute: async (invocation) => {
          invocations.push(invocation.capabilityId);
          return { capability: invocation.capabilityId };
        },
      },
    });

    expect(invocations).toEqual(["filesystem.write", "browser.open"]);
    expect(result.task.status).toBe("COMPLETED");
    expect(result.task.currentStep).toBe(2);
    expect(result.task.result).toEqual([
      { capability: "filesystem.write" },
      { capability: "browser.open" },
    ]);
    expect(result.task.updatedAt).toBe("2026-09-30T01:00:00.000Z");
    expect(task.status).toBe("RUNNING");
    expect(task.currentStep).toBe(0);
  });

  it("fails immediately when a capability cannot be resolved", async () => {
    let calls = 0;

    const result = await executeTask({
      task: {
        ...task,
        plan: [{ ...task.plan[0], capabilityId: "missing.capability" }],
      },
      device,
      permission,
      resolveCapability,
      backend: {
        execute: async () => {
          calls += 1;
          return {};
        },
      },
      now: "2026-09-30T01:01:00.000Z",
    });

    expect(result.task.status).toBe("FAILED");
    expect(result.task.error).toBe("capability_not_found:missing.capability");
    expect(calls).toBe(0);
  });

  it("fails at the first tool error and does not run later steps", async () => {
    let calls = 0;

    const result = await executeTask({
      task,
      device,
      permission,
      resolveCapability,
      backend: {
        execute: async () => {
          calls += 1;
          throw new Error("backend unavailable");
        },
      },
    });

    expect(calls).toBe(1);
    expect(result.stepResults).toHaveLength(1);
    expect(result.task.status).toBe("FAILED");
    expect(result.task.currentStep).toBe(0);
    expect(result.task.error).toBe("backend unavailable");
  });

  it("rejects a non-running task before execution", async () => {
    await expect(
      executeTask({
        task: { ...task, status: "PAUSED" },
        device,
        permission,
        resolveCapability,
        backend: { execute: async () => ({}) },
      }),
    ).rejects.toThrow("Task must be RUNNING");
  });

  it("rejects a task without a target device", async () => {
    await expect(
      executeTask({
        task: { ...task, deviceId: undefined },
        device,
        permission,
        resolveCapability,
        backend: { execute: async () => ({}) },
      }),
    ).rejects.toThrow("Task must be bound to a target device");
  });

  it("does not let task approval bypass runtime permission checks", async () => {
    let calls = 0;

    const result = await executeTask({
      task: {
        ...task,
        plan: [{
          ...task.plan[0],
          risk: "L2",
          requiresApproval: true,
        }],
        requiresApproval: true,
        approvalStatus: "APPROVED",
      },
      device,
      permission: { ...permission, autonomy: 1 },
      resolveCapability: () => ({
        ...capabilities[0],
        risk: "L2",
      }),
      backend: {
        execute: async () => {
          calls += 1;
          return {};
        },
      },
    });

    expect(result.task.status).toBe("FAILED");
    expect(result.task.error).toBe("autonomy_level_too_low");
    expect(calls).toBe(0);
  });
});
