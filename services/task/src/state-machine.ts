import type { AgentTask, TaskStatus } from "../../../packages/protocol/src/tasks";

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
  if (from === "WAITING_APPROVAL" && to === "RUNNING") {
    throw new Error("Approval transition requires transitionAfterApproval");
  }

  if (!canTransition(from, to)) {
    throw new Error(`Invalid task transition: ${from} -> ${to}`);
  }
  return to;
}

export function transitionAfterApproval(task: AgentTask): TaskStatus {
  if (task.status !== "WAITING_APPROVAL") {
    throw new Error(
      `Approval transition requires WAITING_APPROVAL, got ${task.status}`,
    );
  }

  if (task.approvalStatus !== "APPROVED") {
    throw new Error("Task approval is required before execution");
  }

  return "RUNNING";
}
