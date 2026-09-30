export type EventType =
  | "conversation.created"
  | "conversation.updated"
  | "memory.created"
  | "memory.write.requested"
  | "memory.updated"
  | "memory.deleted"
  | "relationship.changed"
  | "emotion.changed"
  | "task.created"
  | "task.started"
  | "task.progress"
  | "task.waiting_user"
  | "task.completed"
  | "task.failed"
  | "task.paused"
  | "task.resumed"
  | "task.cancelled"
  | "task.approval_requested"
  | "task.approved"
  | "task.rejected"
  | "tool.started"
  | "tool.completed"
  | "device.connected"
  | "device.disconnected"
  | "avatar.emotion"
  | "notification.requested";

export interface DomainEvent<T = unknown> {
  id: string;
  type: EventType;
  version: number;
  occurredAt: string;
  userId: string;
  companionId: string;
  sessionId?: string;
  source: string;
  data: T;
}

export type TaskAuditEventType =
  | "task.created"
  | "task.started"
  | "task.progress"
  | "task.waiting_user"
  | "task.completed"
  | "task.failed"
  | "task.paused"
  | "task.resumed"
  | "task.cancelled"
  | "task.approval_requested"
  | "task.approved"
  | "task.rejected";

export interface TaskAuditEventData {
  taskId: string;
  taskVersion: number;
  status: string;
  currentStep: number;
  actor: "user" | "agent" | "system";
  capabilityId?: string;
  reason?: string;
  errorCode?: string;
}
