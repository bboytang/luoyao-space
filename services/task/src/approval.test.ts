import { describe, expect, it } from "vitest";
import { approveTask } from "./approval";
import type { AgentTask } from "../../../packages/protocol/src/tasks";

function task(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    taskId: "task-1",
    userId: "user-1",
    companionId: "luoyao",
    goal: "修改项目",
    status: "WAITING_APPROVAL",
    plan: [{
      id: "step-1",
      capabilityId: "filesystem.write",
      description: "写入文件",
      risk: "L2",
      requiredPermissions: ["filesystem.write"],
      requiresApproval: true,
      input: { path: "README.md" },
    }],
    currentStep: 0,
    requiresApproval: true,
    approvalStatus: "PENDING",
    deviceId: "desktop-1",
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
    ...overrides,
  };
}

function permission(overrides: Partial<Parameters<typeof approveTask>[0]["permission"]> = {}) {
  return {
    autonomy: 2 as const,
    grantedPermissions: ["filesystem.write"],
    deviceId: "desktop-1",
    devicePermissions: {},
    ...overrides,
  };
}

describe("approveTask", () => {
  it("approves a task only after rechecking permissions and device scope", () => {
    const result = approveTask({
      task: task(),
      permission: permission(),
      approvedDeviceId: "desktop-1",
      now: "2026-09-30T01:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.task.status).toBe("RUNNING");
      expect(result.task.approvalStatus).toBe("APPROVED");
      expect(result.task.updatedAt).toBe("2026-09-30T01:00:00.000Z");
    }
  });

  it("rejects approval when autonomy is insufficient", () => {
    const result = approveTask({
      task: task(),
      permission: permission({ autonomy: 1 }),
      approvedDeviceId: "desktop-1",
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "approval_authorization_failed",
      failures: [{ decision: { reason: "autonomy_level_too_low" } }],
    });
  });

  it("rejects approval when the required permission is missing", () => {
    const result = approveTask({
      task: task(),
      permission: permission({ grantedPermissions: [] }),
      approvedDeviceId: "desktop-1",
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "approval_authorization_failed",
      failures: [{ decision: { reason: "missing_permission:filesystem.write" } }],
    });
  });

  it("rejects approval for a different device", () => {
    const result = approveTask({
      task: task(),
      permission: permission({ deviceId: "desktop-2" }),
      approvedDeviceId: "desktop-2",
    });

    expect(result).toMatchObject({ ok: false, reason: "approved_device_mismatch" });
  });

  it("rejects approval when the task is no longer pending", () => {
    const result = approveTask({
      task: task({ approvalStatus: "APPROVED" }),
      permission: permission(),
      approvedDeviceId: "desktop-1",
    });

    expect(result).toMatchObject({ ok: false, reason: "task_approval_not_pending" });
  });

  it("requires explicit approval for L3 even when autonomy and permissions are available", () => {
    const highImpactTask = task({
      plan: [{
        id: "step-1",
        capabilityId: "account.change_credentials",
        description: "修改凭据",
        risk: "L3",
        requiredPermissions: ["account.security"],
        requiresApproval: true,
        input: {},
      }],
    });

    const result = approveTask({
      task: highImpactTask,
      permission: permission({
        autonomy: 3,
        grantedPermissions: ["account.security"],
      }),
      approvedDeviceId: "desktop-1",
    });

    expect(result.ok).toBe(true);
  });

  it("does not mutate the original task", () => {
    const original = task();
    const result = approveTask({
      task: original,
      permission: permission(),
      approvedDeviceId: "desktop-1",
    });

    expect(result.ok).toBe(true);
    expect(original.status).toBe("WAITING_APPROVAL");
    expect(original.approvalStatus).toBe("PENDING");
  });
});
