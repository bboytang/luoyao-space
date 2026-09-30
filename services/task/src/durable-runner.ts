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
  if (task.currentStep >= task.plan.length) {
    throw new Error("Task has no remaining steps");
  }

  const step = task.plan[task.currentStep];
  const capability = input.resolveCapability(step.capabilityId);

  if (!capability) {
    const failed = failTask(task, "capability_not_found:" + step.capabilityId, input.now);
    const persisted = await input.lifecycle.persistTransition({
      previous: task,
      next: failed,
      eventType: "task.failed",
      actor: "agent",
      source: "durable-task-runner",
      capabilityId: step.capabilityId,
      reason: "capability_not_found",
      occurredAt: input.now,
    });
    return { task: persisted };
  }

  const result = await executeTaskStep({
    task,
    capability,
    device: input.device,
    permission: input.permission,
    backend: input.backend,
    invocationId: input.invocationId?.(task),
  });

  if (!result.ok) {
    if (result.error?.code === "USER_INPUT_REQUIRED") {
      const waiting = requestUserInput(task, input.now);
      const persisted = await input.lifecycle.persistTransition({
        previous: task,
        next: waiting,
        eventType: "task.waiting_user",
        actor: "agent",
        source: "durable-task-runner",
        capabilityId: step.capabilityId,
        reason: result.error.message,
        errorCode: result.error.code,
        occurredAt: input.now,
      });
      return { task: persisted, stepResult: result };
    }

    const failed = failTask(
      task,
      result.error?.message ?? "task_step_execution_failed",
      input.now,
    );
    const persisted = await input.lifecycle.persistTransition({
      previous: task,
      next: failed,
      eventType: "task.failed",
      actor: "agent",
      source: "durable-task-runner",
      capabilityId: step.capabilityId,
      reason: result.error?.message,
      errorCode: result.error?.code,
      occurredAt: input.now,
    });
    return { task: persisted, stepResult: result };
  }

  const nextStep = task.currentStep + 1;
  const completed = nextStep >= task.plan.length;
  const next: AgentTask = {
    ...task,
    currentStep: nextStep,
    status: completed ? "COMPLETED" : "RUNNING",
    version: task.version + 1,
    result: appendStepOutput(task.result, result.output),
    updatedAt: input.now ?? new Date().toISOString(),
  };

  const persisted = await input.lifecycle.persistTransition({
    previous: task,
    next,
    eventType: completed ? "task.completed" : "task.progress",
    actor: "agent",
    source: "durable-task-runner",
    capabilityId: step.capabilityId,
    occurredAt: input.now,
  });

  return { task: persisted, stepResult: result };
}

function appendStepOutput(existing: unknown, output: unknown): unknown[] {
  return [...(Array.isArray(existing) ? existing : []), output];
}

function failTask(task: AgentTask, error: string, now?: string): AgentTask {
  return {
    ...task,
    status: "FAILED",
    error,
    version: task.version + 1,
    updatedAt: now ?? new Date().toISOString(),
  };
}
