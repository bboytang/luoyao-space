export type TaskStatus =
  | "PENDING"
  | "PLANNING"
  | "WAITING_APPROVAL"
  | "RUNNING"
  | "WAITING_USER"
  | "COMPLETED"
  | "FAILED"
  | "PAUSED"
  | "CANCELLED";

export interface AgentTask {
  taskId: string;
  userId: string;
  companionId: string;
  goal: string;
  status: TaskStatus;
  plan: string[];
  currentStep: number;
  requiresApproval: boolean;
  approvalStatus?: "PENDING" | "APPROVED" | "REJECTED";
  deviceId?: string;
  executionContext?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
