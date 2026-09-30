import type { AgentTask } from "../../../packages/protocol/src/tasks";
import { TaskConcurrencyError, TaskLeaseError, type TaskRepository } from "./repository";

export interface SqlQueryResult<Row> { rows: Row[]; }
export interface SqlClient {
  query<Row = unknown>(text: string, values?: readonly unknown[]): Promise<SqlQueryResult<Row>>;
}

interface TaskRow {
  task_id: string; user_id: string; companion_id: string; goal: string;
  status: AgentTask["status"]; plan: AgentTask["plan"]; current_step: number;
  requires_approval: boolean; approval_status: AgentTask["approvalStatus"] | null;
  device_id: string | null; execution_context: Record<string, unknown> | null;
  result: unknown; error: string | null; version: number | string;
  execution_lease_id: string | null; execution_lease_expires_at: string | null;
  created_at: string; updated_at: string;
}

function toTask(row: TaskRow): AgentTask {
  return {
    taskId: row.task_id, userId: row.user_id, companionId: row.companion_id,
    goal: row.goal, status: row.status,
    plan: row.plan.map((step) => ({ ...step, requiredPermissions: [...step.requiredPermissions] })),
    currentStep: row.current_step, requiresApproval: row.requires_approval,
    ...(row.approval_status ? { approvalStatus: row.approval_status } : {}),
    ...(row.device_id ? { deviceId: row.device_id } : {}),
    ...(row.execution_context ? { executionContext: { ...row.execution_context } } : {}),
    ...(row.result !== null ? { result: row.result } : {}),
    ...(row.error ? { error: row.error } : {}),
    version: Number(row.version),
    ...(row.execution_lease_id ? { executionLeaseId: row.execution_lease_id } : {}),
    ...(row.execution_lease_expires_at ? { executionLeaseExpiresAt: row.execution_lease_expires_at } : {}),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

const selectColumns = [
  "task_id","user_id","companion_id","goal","status","plan","current_step",
  "requires_approval","approval_status","device_id","execution_context","result","error",
  "version","execution_lease_id","execution_lease_expires_at","created_at::text","updated_at::text",
].join(",");

export class PostgresTaskRepository implements TaskRepository {
  constructor(private readonly client: SqlClient) {}

  async create(task: AgentTask): Promise<AgentTask> {
    if (task.version !== 1) throw new Error("New tasks must start at version 1");
    const result = await this.client.query<TaskRow>(
      `INSERT INTO agent_tasks (
        task_id,user_id,companion_id,goal,status,plan,current_step,requires_approval,
        approval_status,device_id,execution_context,result,error,version,
        execution_lease_id,execution_lease_expires_at,created_at,updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,
        $15,$16::timestamptz,$17::timestamptz,$18::timestamptz
      ) RETURNING ${selectColumns}`,
      [
        task.taskId,task.userId,task.companionId,task.goal,task.status,JSON.stringify(task.plan),
        task.currentStep,task.requiresApproval,task.approvalStatus ?? null,task.deviceId ?? null,
        task.executionContext ? JSON.stringify(task.executionContext) : null,
        task.result !== undefined ? JSON.stringify(task.result) : null,task.error ?? null,task.version,
        task.executionLeaseId ?? null,task.executionLeaseExpiresAt ?? null,task.createdAt,task.updatedAt,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Task insert returned no row");
    return toTask(row);
  }

  async get(input: { taskId: string; userId: string; companionId: string }): Promise<AgentTask | null> {
    const result = await this.client.query<TaskRow>(
      `SELECT ${selectColumns} FROM agent_tasks WHERE task_id=$1 AND user_id=$2 AND companion_id=$3`,
      [input.taskId,input.userId,input.companionId],
    );
    const row = result.rows[0];
    return row ? toTask(row) : null;
  }

  async update(input: { task: AgentTask; expectedVersion: number }): Promise<AgentTask> {
    if (input.task.version !== input.expectedVersion + 1) {
      throw new Error("Task version must advance exactly once");
    }
    const task = input.task;
    const result = await this.client.query<TaskRow>(
      `UPDATE agent_tasks
       SET goal=$4,status=$5,plan=$6::jsonb,current_step=$7,requires_approval=$8,
           approval_status=$9,device_id=$10,execution_context=$11::jsonb,result=$12::jsonb,
           error=$13,version=$14,execution_lease_id=$15,execution_lease_expires_at=$16::timestamptz,
           updated_at=$17::timestamptz
       WHERE task_id=$1 AND user_id=$2 AND companion_id=$3 AND version=$18
       RETURNING ${selectColumns}`,
      [
        task.taskId,task.userId,task.companionId,task.goal,task.status,JSON.stringify(task.plan),
        task.currentStep,task.requiresApproval,task.approvalStatus ?? null,task.deviceId ?? null,
        task.executionContext ? JSON.stringify(task.executionContext) : null,
        task.result !== undefined ? JSON.stringify(task.result) : null,task.error ?? null,task.version,
        task.executionLeaseId ?? null,task.executionLeaseExpiresAt ?? null,task.updatedAt,input.expectedVersion,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new TaskConcurrencyError();
    return toTask(row);
  }

  async claimStep(input: {
    task: AgentTask; leaseId: string; leaseExpiresAt: string; now: string;
  }): Promise<AgentTask> {
    const result = await this.client.query<TaskRow>(
      `UPDATE agent_tasks
       SET execution_lease_id=$4, execution_lease_expires_at=$5::timestamptz,
           version=version+1, updated_at=$6::timestamptz
       WHERE task_id=$1 AND user_id=$2 AND companion_id=$3
         AND status='RUNNING' AND version=$7
         AND (execution_lease_id IS NULL OR execution_lease_expires_at <= $6::timestamptz)
       RETURNING ${selectColumns}`,
      [
        input.task.taskId,input.task.userId,input.task.companionId,input.leaseId,
        input.leaseExpiresAt,input.now,input.task.version,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new TaskLeaseError();
    return toTask(row);
  }
}
