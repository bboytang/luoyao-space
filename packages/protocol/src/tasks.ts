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

export interface TaskPlanStep {
  id: string;
  capabilityId: string;
  description: string;
  risk: "L0" | "L1" | "L2" | "L3";
  requiredPermissions: string[];
  requiresApproval: boolean;
  input: unknown;
}

export interface AgentTask {
  taskId: string;
  userId: string;
  companionId: string;
  goal: string;
  status: TaskStatus;
  plan: TaskPlanStep[];
  currentStep: number;
  requiresApproval: boolean;
  approvalStatus?: "PENDING" | "APPROVED" | "REJECTED";
  deviceId?: string;
  executionContext?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
