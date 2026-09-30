import type { AgentTask } from "../../../packages/protocol/src/tasks";
import { transitionAfterApproval } from "./state-machine";
import {
  authorize,
  type PermissionContext,
  type PermissionDecision,
} from "../../tool-runtime/src/permissions";

export interface ApproveTaskInput {
  task: AgentTask;
  permission: Omit<PermissionContext, "approvalGranted">;
  approvedDeviceId: string;
  now?: string;
}

export interface ApprovalFailure {
  stepId: string;
  capabilityId: string;
  decision: PermissionDecision;
}

export type ApprovalResult =
  | { ok: true; task: AgentTask }
  | { ok: false; reason: string; failures: ApprovalFailure[] };

export function approveTask(input: ApproveTaskInput): ApprovalResult {
  const { task } = input;

  if (task.status !== "WAITING_APPROVAL") {
    return { ok: false, reason: "task_not_waiting_for_approval", failures: [] };
  }

  if (task.approvalStatus !== "PENDING") {
    return { ok: false, reason: "task_approval_not_pending", failures: [] };
  }

  if (!input.approvedDeviceId.trim()) {
    return { ok: false, reason: "approved_device_required", failures: [] };
  }

  if (task.deviceId && task.deviceId !== input.approvedDeviceId) {
    return { ok: false, reason: "approved_device_mismatch", failures: [] };
  }

  if (input.permission.deviceId !== input.approvedDeviceId) {
    return { ok: false, reason: "permission_device_mismatch", failures: [] };
  }

  const failures: ApprovalFailure[] = [];

  for (const step of task.plan) {
    const decision = authorize(step.risk, step.requiredPermissions, {
      ...input.permission,
      deviceId: input.approvedDeviceId,
      approvalGranted: true,
    });

    if (!decision.allowed) {
      failures.push({
        stepId: step.id,
        capabilityId: step.capabilityId,
        decision,
      });
    }
  }

  if (failures.length > 0) {
    return { ok: false, reason: "approval_authorization_failed", failures };
  }

  const approvedTask: AgentTask = {
    ...task,
    status: transitionAfterApproval({
      ...task,
      approvalStatus: "APPROVED",
    }),
    approvalStatus: "APPROVED",
    updatedAt: input.now ?? new Date().toISOString(),
  };

  return { ok: true, task: approvedTask };
}
