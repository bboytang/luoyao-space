import type { CapabilityDefinition, CapabilityResult } from "../../../packages/protocol/src/capabilities";
import type { DeviceIdentity } from "../../../packages/protocol/src/identity";
import type { AgentTask } from "../../../packages/protocol/src/tasks";
import { transition } from "./state-machine";
import {
  executeTaskStep,
  type ExecuteTaskStepInput,
} from "./task-executor";

export interface ExecuteTaskInput {
  task: AgentTask;
  device: DeviceIdentity;
  resolveCapability: (
    capabilityId: string,
  ) => CapabilityDefinition | undefined;
  permission: ExecuteTaskStepInput["permission"];
  backend: ExecuteTaskStepInput["backend"];
  createInvocationId?: (task: AgentTask) => string;
  now?: string;
}

export interface TaskExecutionResult {
  task: AgentTask;
  stepResults: CapabilityResult[];
}

export async function executeTask(
  input: ExecuteTaskInput,
): Promise<TaskExecutionResult> {
  let task = cloneTask(input.task);
  const stepResults: CapabilityResult[] = [];

  if (task.status !== "RUNNING") {
    throw new Error(`Task must be RUNNING to execute, got ${task.status}`);
  }

  if (!input.device.deviceId.trim()) {
    throw new Error("Task execution requires a target device");
  }

  if (!task.deviceId) {
    throw new Error("Task must be bound to a target device");
  }

  if (task.deviceId !== input.device.deviceId) {
    throw new Error("Task target device does not match execution device");
  }

  while (task.currentStep < task.plan.length) {
    const step = task.plan[task.currentStep];
    const capability = input.resolveCapability(step.capabilityId);

    if (!capability) {
      task = failTask(task, `capability_not_found:${step.capabilityId}`, input.now);
      return { task, stepResults };
    }

    const result = await executeTaskStep({
      task,
      capability,
      device: input.device,
      permission: input.permission,
      backend: input.backend,
      invocationId: input.createInvocationId?.(task),
    });

    stepResults.push(result);

    if (!result.ok) {
      task = failTask(
        task,
        result.error?.message ?? "task_step_execution_failed",
        input.now,
      );
      return { task, stepResults };
    }

    const nextStep = task.currentStep + 1;
    const nextStatus =
      nextStep >= task.plan.length
        ? transition(task.status, "COMPLETED")
        : task.status;

    task = {
      ...task,
      currentStep: nextStep,
      status: nextStatus,
      ...(nextStatus === "COMPLETED" ? { result: stepResults.map(getOutput) } : {}),
      updatedAt: input.now ?? new Date().toISOString(),
    };
  }

  return { task, stepResults };
}

function failTask(task: AgentTask, error: string, now?: string): AgentTask {
  return {
    ...task,
    status: transition(task.status, "FAILED"),
    error,
    updatedAt: now ?? new Date().toISOString(),
  };
}

function getOutput(result: CapabilityResult): unknown {
  return result.output;
}

function cloneTask(task: AgentTask): AgentTask {
  return {
    ...task,
    plan: task.plan.map((step) => ({
      ...step,
      requiredPermissions: [...step.requiredPermissions],
    })),
    ...(task.executionContext
      ? { executionContext: { ...task.executionContext } }
      : {}),
  };
}
