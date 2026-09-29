export type EventType =
  | "conversation.created"
  | "conversation.updated"
  | "memory.created"
  | "relationship.changed"
  | "emotion.changed"
  | "task.created"
  | "task.started"
  | "task.progress"
  | "task.completed"
  | "task.failed"
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
