import type { AgentTask, TaskPlanStep } from "../../../packages/protocol/src/tasks";

export interface TaskPlanInput {
  goal: string;
  steps: readonly TaskPlanStep[];
  requiresApproval: boolean;
}

export interface CreateTaskFromPlanInput {
  userId: string;
  companionId: string;
  plan: TaskPlanInput;
  taskId?: string;
  deviceId?: string;
  executionContext?: Record<string, unknown>;
  now?: string;
}

export function createTaskFromPlan(input: CreateTaskFromPlanInput): AgentTask {
  const goal = input.plan.goal.trim();
  if (!goal) throw new Error("Task goal must not be empty");
  if (input.plan.steps.length === 0) {
    throw new Error("Task plan must contain at least one step");
  }
  if (!input.userId.trim()) throw new Error("Task userId must not be empty");
  if (!input.companionId.trim()) throw new Error("Task companionId must not be empty");

  const requiresApproval = input.plan.steps.some((step) => step.requiresApproval);
  if (requiresApproval !== input.plan.requiresApproval) {
    throw new Error("Task plan approval requirement is inconsistent");
  }

  const now = input.now ?? new Date().toISOString();
  const task: AgentTask = {
    taskId: input.taskId ?? crypto.randomUUID(),
    userId: input.userId,
    companionId: input.companionId,
    goal,
    status: requiresApproval ? "WAITING_APPROVAL" : "RUNNING",
    plan: input.plan.steps.map(clonePlanStep),
    currentStep: 0,
    requiresApproval,
    ...(requiresApproval ? { approvalStatus: "PENDING" as const } : {}),
    ...(input.deviceId ? { deviceId: input.deviceId } : {}),
    ...(input.executionContext ? { executionContext: { ...input.executionContext } } : {}),
    version: 1,
    createdAt: now,
    updatedAt: now,
  };

  return task;
}

function clonePlanStep(step: TaskPlanStep): TaskPlanStep {
  return {
    id: step.id,
    capabilityId: step.capabilityId,
    description: step.description,
    risk: step.risk,
    requiredPermissions: [...step.requiredPermissions],
    requiresApproval: step.requiresApproval,
    input: step.input,
  };
}
