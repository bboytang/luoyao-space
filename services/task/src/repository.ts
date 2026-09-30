import type { AgentTask } from "../../../packages/protocol/src/tasks";

export interface TaskRepository {
  create(task: AgentTask): Promise<AgentTask>;
  get(input: {
    taskId: string;
    userId: string;
    companionId: string;
  }): Promise<AgentTask | null>;
  update(input: {
    task: AgentTask;
    expectedVersion: number;
  }): Promise<AgentTask>;
  claimStep(input: {
    task: AgentTask;
    leaseId: string;
    leaseExpiresAt: string;
    now: string;
  }): Promise<AgentTask>;
}

export class TaskConcurrencyError extends Error {
  readonly code = "TASK_CONCURRENCY_CONFLICT";

  constructor(message = "Task version conflict") {
    super(message);
    this.name = "TaskConcurrencyError";
  }
}

export class TaskLeaseError extends Error {
  readonly code = "TASK_EXECUTION_LEASE_UNAVAILABLE";

  constructor(message = "Task execution lease unavailable") {
    super(message);
    this.name = "TaskLeaseError";
  }
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

export class InMemoryTaskRepository implements TaskRepository {
  private readonly tasks = new Map<string, AgentTask>();

  async create(task: AgentTask): Promise<AgentTask> {
    if (this.tasks.has(task.taskId)) throw new Error("Task already exists");
    const stored = cloneTask({ ...task, version: 1 });
    this.tasks.set(task.taskId, stored);
    return cloneTask(stored);
  }

  async get(input: {
    taskId: string;
    userId: string;
    companionId: string;
  }): Promise<AgentTask | null> {
    const task = this.tasks.get(input.taskId);
    if (!task || task.userId !== input.userId || task.companionId !== input.companionId) {
      return null;
    }
    return cloneTask(task);
  }

  async update(input: {
    task: AgentTask;
    expectedVersion: number;
  }): Promise<AgentTask> {
    const current = this.tasks.get(input.task.taskId);
    if (!current || current.userId !== input.task.userId || current.companionId !== input.task.companionId) {
      throw new Error("Task not found");
    }
    if (current.version !== input.expectedVersion) throw new TaskConcurrencyError();
    if (input.task.version !== input.expectedVersion + 1) {
      throw new Error("Task version must advance exactly once");
    }
    const updated = cloneTask(input.task);
    this.tasks.set(updated.taskId, updated);
    return cloneTask(updated);
  }

  async claimStep(input: {
    task: AgentTask;
    leaseId: string;
    leaseExpiresAt: string;
    now: string;
  }): Promise<AgentTask> {
    const current = this.tasks.get(input.task.taskId);
    if (!current || current.userId !== input.task.userId || current.companionId !== input.task.companionId) {
      throw new Error("Task not found");
    }
    if (current.version !== input.task.version) throw new TaskConcurrencyError();
    if (current.status !== "RUNNING") throw new TaskLeaseError("Task is not running");
    if (current.executionLeaseId && current.executionLeaseExpiresAt && current.executionLeaseExpiresAt > input.now) {
      throw new TaskConcurrencyError("Task execution lease is already held");
    }

    const claimed = cloneTask({
      ...current,
      executionLeaseId: input.leaseId,
      executionLeaseExpiresAt: input.leaseExpiresAt,
      version: current.version + 1,
      updatedAt: input.now,
    });
    this.tasks.set(claimed.taskId, claimed);
    return cloneTask(claimed);
  }
}
