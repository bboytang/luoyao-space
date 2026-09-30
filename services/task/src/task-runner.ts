import type { CapabilityDefinition, CapabilityResult } from "../../../packages/protocol/src/capabilities";
import type { DeviceIdentity } from "../../../packages/protocol/src/identity";
import type { AgentTask } from "../../../packages/protocol/src/tasks";
import { TaskConcurrencyError, type TaskRepository } from "./repository";
import { TaskLifecycleService } from "./lifecycle";
import {
  executeDurableTaskStep,
  type ExecuteDurableTaskInput,
} from "./durable-runner";

export interface ExecuteTaskInput {
  task: AgentTask;
  device: DeviceIdentity;
  repository: TaskRepository;
  lifecycle: TaskLifecycleService;
  resolveCapability: (
    capabilityId: string,
  ) => CapabilityDefinition | undefined;
  permission: ExecuteDurableTaskInput["permission"];
  backend: ExecuteDurableTaskInput["backend"];
  createInvocationId?: (task: AgentTask) => string;
  leaseDurationMs?: number;
  now?: string;
}

export interface TaskExecutionResult {
  task: AgentTask;
  stepResults: CapabilityResult[];
}

export async function executeTask(
  input: ExecuteTaskInput,
): Promise<TaskExecutionResult> {
  validateExecutionTarget(input.task, input.device);

  const persisted = await input.repository.get({
    taskId: input.task.taskId,
    userId: input.task.userId,
    companionId: input.task.companionId,
  });

  if (!persisted) {
    throw new Error("Task not found");
  }

  if (persisted.version !== input.task.version) {
    throw new TaskConcurrencyError();
  }

  let task = persisted;
  const stepResults: CapabilityResult[] = [];

  while (task.status === "RUNNING") {
    const result = await executeDurableTaskStep({
      taskId: task.taskId,
      userId: task.userId,
      companionId: task.companionId,
      device: input.device,
      repository: input.repository,
      lifecycle: input.lifecycle,
      resolveCapability: input.resolveCapability,
      permission: input.permission,
      backend: input.backend,
      invocationId: input.createInvocationId,
      leaseDurationMs: input.leaseDurationMs,
      now: input.now,
    });

    if (result.stepResult) {
      stepResults.push(result.stepResult);
    }

    task = result.task;
  }

  return { task, stepResults };
}

function validateExecutionTarget(
  task: AgentTask,
  device: DeviceIdentity,
): void {
  if (task.status !== "RUNNING") {
    throw new Error(`Task must be RUNNING to execute, got ${task.status}`);
  }

  if (!device.deviceId.trim()) {
    throw new Error("Task execution requires a target device");
  }

  if (!task.deviceId) {
    throw new Error("Task must be bound to a target device");
  }

  if (task.deviceId !== device.deviceId) {
    throw new Error("Task target device does not match execution device");
  }
}
