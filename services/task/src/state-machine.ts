import type { TaskStatus } from "../../../packages/protocol/src/tasks";

const transitions: Record<TaskStatus, TaskStatus[]> = {
  PENDING: ["PLANNING", "CANCELLED"],
  PLANNING: ["WAITING_APPROVAL", "RUNNING", "FAILED", "CANCELLED"],
  WAITING_APPROVAL: ["RUNNING", "CANCELLED"],
  RUNNING: ["WAITING_USER", "COMPLETED", "FAILED", "PAUSED"],
  WAITING_USER: ["RUNNING", "CANCELLED"],
  COMPLETED: [],
  FAILED: ["PLANNING", "CANCELLED"],
  PAUSED: ["RUNNING", "CANCELLED"],
  CANCELLED: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return transitions[from].includes(to);
}

export function transition(from: TaskStatus, to: TaskStatus): TaskStatus {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid task transition: ${from} -> ${to}`);
  }
  return to;
}
