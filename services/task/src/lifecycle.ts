import type { TaskAuditEventData, TaskAuditEventType } from "../../../packages/protocol/src/events";
import type { AgentTask } from "../../../packages/protocol/src/tasks";
import {
  createTaskAuditEvent,
  type TaskEventPublisher,
} from "./events";
import type { TaskRepository } from "./repository";

export interface PersistTaskTransitionInput {
  previous: AgentTask;
  next: AgentTask;
  eventType: TaskAuditEventType;
  actor: TaskAuditEventData["actor"];
  source: string;
  capabilityId?: string;
  reason?: string;
  errorCode?: string;
  occurredAt?: string;
  sessionId?: string;
}

export class TaskLifecycleService {
  constructor(
    private readonly repository: TaskRepository,
    private readonly events: TaskEventPublisher,
  ) {}

  async create(task: AgentTask, options?: {
    actor?: TaskAuditEventData["actor"];
    source?: string;
    occurredAt?: string;
    sessionId?: string;
  }): Promise<AgentTask> {
    const created = await this.repository.create(task);
    await this.events.publish(createTaskAuditEvent({
      task: created,
      type: "task.created",
      actor: options?.actor ?? "system",
      source: options?.source ?? "task-service",
      occurredAt: options?.occurredAt ?? created.createdAt,
      sessionId: options?.sessionId,
    }));
    return created;
  }

  async persistTransition(
    input: PersistTaskTransitionInput,
  ): Promise<AgentTask> {
    assertTransition(input.previous, input.next);

    const persisted = await this.repository.update({
      task: input.next,
      expectedVersion: input.previous.version,
    });

    await this.events.publish(createTaskAuditEvent({
      task: persisted,
      type: input.eventType,
      actor: input.actor,
      source: input.source,
      capabilityId: input.capabilityId,
      reason: input.reason,
      errorCode: input.errorCode,
      occurredAt: input.occurredAt ?? persisted.updatedAt,
      sessionId: input.sessionId,
    }));

    return persisted;
  }
}

function assertTransition(previous: AgentTask, next: AgentTask): void {
  if (previous.taskId !== next.taskId) {
    throw new Error("Task transition cannot change taskId");
  }
  if (previous.userId !== next.userId) {
    throw new Error("Task transition cannot change userId");
  }
  if (previous.companionId !== next.companionId) {
    throw new Error("Task transition cannot change companionId");
  }
  if (next.version !== previous.version + 1) {
    throw new Error("Task transition must advance version exactly once");
  }
}
