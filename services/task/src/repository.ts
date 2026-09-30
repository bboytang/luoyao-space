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
}

export class TaskConcurrencyError extends Error {
  readonly code = "TASK_CONCURRENCY_CONFLICT";

  constructor(message = "Task version conflict") {
    super(message);
    this.name = "TaskConcurrencyError";
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
    if (this.tasks.has(task.taskId)) {
      throw new Error("Task already exists");
    }
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
    if (
      !task ||
      task.userId !== input.userId ||
      task.companionId !== input.companionId
    ) {
      return null;
    }
    return cloneTask(task);
  }

  async update(input: {
    task: AgentTask;
    expectedVersion: number;
  }): Promise<AgentTask> {
    const current = this.tasks.get(input.task.taskId);
    if (
      !current ||
      current.userId !== input.task.userId ||
      current.companionId !== input.task.companionId
    ) {
      throw new Error("Task not found");
    }

    if (current.version !== input.expectedVersion) {
      throw new TaskConcurrencyError();
    }

    const updated = cloneTask({
      ...input.task,
      version: current.version + 1,
    });
    this.tasks.set(updated.taskId, updated);
    return cloneTask(updated);
  }
}
