import type {
  CapabilityDefinition,
  CapabilityInvocation,
  CapabilityResult,
} from "../../../packages/protocol/src/capabilities";
import type { AgentTask, TaskPlanStep } from "../../../packages/protocol/src/tasks";
import type { DeviceIdentity } from "../../../packages/protocol/src/identity";
import {
  executeCapability,
  type CapabilityBackend,
  type ToolExecutionContext,
} from "../../tool-runtime/src/runner";

export interface ExecuteTaskStepInput {
  task: AgentTask;
  capability: CapabilityDefinition;
  device: DeviceIdentity;
  permission: ToolExecutionContext["permission"];
  backend: CapabilityBackend;
  invocationId?: string;
}

export async function executeTaskStep(
  input: ExecuteTaskStepInput,
): Promise<CapabilityResult> {
  const { task, capability, device } = input;

  if (task.status !== "RUNNING") {
    return denied(input.invocationId, "task_not_running");
  }

  if (task.currentStep < 0 || task.currentStep >= task.plan.length) {
    return denied(input.invocationId, "task_current_step_out_of_range");
  }

  if (task.deviceId && task.deviceId !== device.deviceId) {
    return denied(input.invocationId, "task_device_mismatch");
  }

  const step = task.plan[task.currentStep];

  if (step.capabilityId !== capability.id) {
    return denied(input.invocationId, "task_capability_mismatch");
  }

  if (step.requiresApproval && task.approvalStatus !== "APPROVED") {
    return denied(input.invocationId, "task_step_approval_required");
  }

  const invocation: CapabilityInvocation = {
    id: input.invocationId ?? crypto.randomUUID(),
    capabilityId: step.capabilityId,
    userId: task.userId,
    deviceId: device.deviceId,
    input: step.input,
    requestedBy: "agent",
  };

  return executeCapability(capability, invocation, {
    device,
    permission: {
      ...input.permission,
      deviceId: device.deviceId,
      approvalGranted: task.approvalStatus === "APPROVED" || !step.requiresApproval,
    },
    backend: input.backend,
  });
}

function denied(invocationId: string | undefined, reason: string): CapabilityResult {
  return {
    invocationId: invocationId ?? "not-created",
    ok: false,
    error: {
      code: "TASK_EXECUTION_DENIED",
      message: reason,
    },
  };
}
