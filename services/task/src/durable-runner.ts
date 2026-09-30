import type { CapabilityDefinition, CapabilityResult } from "../../../packages/protocol/src/capabilities";
import type { DeviceIdentity } from "../../../packages/protocol/src/identity";
import type { AgentTask } from "../../../packages/protocol/src/tasks";
import { requestUserInput } from "./task-control";
import { TaskLifecycleService } from "./lifecycle";
import type { TaskRepository } from "./repository";
import { executeTaskStep, type ExecuteTaskStepInput } from "./task-executor";

export interface ExecuteDurableTaskInput {
  taskId: string;
  userId: string;
  companionId: string;
  device: DeviceIdentity;
  repository: TaskRepository;
  lifecycle: TaskLifecycleService;
  resolveCapability: (capabilityId: string) => CapabilityDefinition | undefined;
  permission: ExecuteTaskStepInput["permission"];
  backend: ExecuteTaskStepInput["backend"];
  invocationId?: (task: AgentTask) => string;
  leaseDurationMs?: number;
  now?: string;
}

export interface DurableTaskStepResult {
  task: AgentTask;
  stepResult?: CapabilityResult;
}

export async function executeDurableTaskStep(
  input: ExecuteDurableTaskInput,
): Promise<DurableTaskStepResult> {
  const task = await input.repository.get({
    taskId: input.taskId,
    userId: input.userId,
    companionId: input.companionId,
  });

  if (!task) throw new Error("Task not found");
  if (task.status !== "RUNNING") {
    throw new Error("Task must be RUNNING to execute, got " + task.status);
  }
  if (!task.deviceId) throw new Error("Task must be bound to a target device");
  if (task.deviceId !== input.device.deviceId) {
    throw new Error("Task target device does not match execution device");
  }
  if (task.currentStep >= task.plan.length) throw new Error("Task has no remaining steps");

  const now = input.now ?? new Date().toISOString();
  const leaseDurationMs = input.leaseDurationMs ?? 60_000;
  if (!Number.isFinite(leaseDurationMs) || leaseDurationMs <= 0) {
    throw new Error("Task lease duration must be positive");
  }
  const leaseId = crypto.randomUUID();
  const leaseExpiresAt = new Date(Date.parse(now) + leaseDurationMs).toISOString();

  const claimed = await input.repository.claimStep({
    task, leaseId, leaseExpiresAt, now,
  });

  const step = claimed.plan[claimed.currentStep];
  const capability = input.resolveCapability(step.capabilityId);

  if (!capability) {
    const failed = failTask(claimed, "capability_not_found:" + step.capabilityId, now);
    return {
      task: await input.lifecycle.persistTransition({
        previous: claimed, next: failed, eventType: "task.failed", actor: "agent",
        source: "durable-task-runner", capabilityId: step.capabilityId,
        reason: "capability_not_found", occurredAt: now,
      }),
    };
  }

  const result = await executeTaskStep({
    task: claimed, capability, device: input.device, permission: input.permission,
    backend: input.backend, invocationId: input.invocationId?.(claimed),
  });

  if (!result.ok) {
    if (result.error?.code === "USER_INPUT_REQUIRED") {
      const waiting = requestUserInput(claimed, now);
      return {
        task: await input.lifecycle.persistTransition({
          previous: claimed, next: waiting, eventType: "task.waiting_user", actor: "agent",
          source: "durable-task-runner", capabilityId: step.capabilityId,
          reason: result.error.message, errorCode: result.error.code, occurredAt: now,
        }),
        stepResult: result,
      };
    }

    const failed = failTask(claimed, result.error?.message ?? "task_step_execution_failed", now);
    return {
      task: await input.lifecycle.persistTransition({
        previous: claimed, next: failed, eventType: "task.failed", actor: "agent",
        source: "durable-task-runner", capabilityId: step.capabilityId,
        reason: result.error?.message, errorCode: result.error?.code, occurredAt: now,
      }),
      stepResult: result,
    };
  }

  const nextStep = claimed.currentStep + 1;
  const completed = nextStep >= claimed.plan.length;
  const next: AgentTask = {
    ...claimed,
    currentStep: nextStep,
    status: completed ? "COMPLETED" : "RUNNING",
    version: claimed.version + 1,
    executionLeaseId: undefined,
    executionLeaseExpiresAt: undefined,
    result: appendStepOutput(claimed.result, result.output),
    updatedAt: now,
  };

  return {
    task: await input.lifecycle.persistTransition({
      previous: claimed, next, eventType: completed ? "task.completed" : "task.progress",
      actor: "agent", source: "durable-task-runner", capabilityId: step.capabilityId, occurredAt: now,
    }),
    stepResult: result,
  };
}

function appendStepOutput(existing: unknown, output: unknown): unknown[] {
  return [...(Array.isArray(existing) ? existing : []), output];
}

function failTask(task: AgentTask, error: string, now: string): AgentTask {
  return {
    ...task, status: "FAILED", error, version: task.version + 1,
    executionLeaseId: undefined, executionLeaseExpiresAt: undefined, updatedAt: now,
  };
}
