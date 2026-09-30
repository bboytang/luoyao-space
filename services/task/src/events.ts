import type {
  DomainEvent,
  TaskAuditEventData,
  TaskAuditEventType,
} from "../../../packages/protocol/src/events";
import type { AgentTask } from "../../../packages/protocol/src/tasks";

export type TaskAuditEvent = DomainEvent<TaskAuditEventData> & {
  type: TaskAuditEventType;
};

export interface TaskEventPublisher {
  publish(event: TaskAuditEvent): Promise<void>;
}

export class InMemoryTaskEventPublisher implements TaskEventPublisher {
  readonly events: TaskAuditEvent[] = [];

  async publish(event: TaskAuditEvent): Promise<void> {
    this.events.push({
      ...event,
      data: { ...event.data },
    });
  }
}

export interface CreateTaskAuditEventInput {
  task: AgentTask;
  type: TaskAuditEventType;
  actor: TaskAuditEventData["actor"];
  source: string;
  occurredAt?: string;
  eventId?: string;
  capabilityId?: string;
  reason?: string;
  errorCode?: string;
  sessionId?: string;
}

export function createTaskAuditEvent(
  input: CreateTaskAuditEventInput,
): TaskAuditEvent {
  return {
    id: input.eventId ?? crypto.randomUUID(),
    type: input.type,
    version: 1,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    userId: input.task.userId,
    companionId: input.task.companionId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    source: input.source,
    data: {
      taskId: input.task.taskId,
      taskVersion: input.task.version,
      status: input.task.status,
      currentStep: input.task.currentStep,
      actor: input.actor,
      ...(input.capabilityId ? { capabilityId: input.capabilityId } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    },
  };
}
