import { describe, expect, it } from "vitest";
import type { AgentTask } from "../../../packages/protocol/src/tasks";
import { PostgresTaskRepository } from "./postgres-repository";
import { TaskConcurrencyError, TaskLeaseError } from "./repository";

const task: AgentTask = {
  taskId: "task-1",
  userId: "user-1",
  companionId: "luoyao",
  goal: "完成项目",
  status: "RUNNING",
  plan: [{
    id: "step-1",
    capabilityId: "test.run",
    description: "执行",
    risk: "L1",
    requiredPermissions: [],
    requiresApproval: false,
    input: {},
  }],
  currentStep: 0,
  requiresApproval: false,
  deviceId: "desktop-1",
  version: 1,
  createdAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T00:00:00.000Z",
};

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    task_id: "task-1",
    user_id: "user-1",
    companion_id: "luoyao",
    goal: task.goal,
    status: "RUNNING",
    plan: task.plan,
    current_step: 0,
    requires_approval: false,
    approval_status: null,
    device_id: "desktop-1",
    execution_context: null,
    result: null,
    error: null,
    version: 1,
    execution_lease_id: null,
    execution_lease_expires_at: null,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    ...overrides,
  };
}

function fakeClient(rows: unknown[]) {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  return {
    calls,
    client: {
      query: async <Row = unknown>(
        text: string,
        values: readonly unknown[] = [],
      ) => {
        calls.push({ text, values });
        return { rows: rows as Row[] };
      },
    },
  };
}

describe("PostgresTaskRepository", () => {
  it("writes JSON task fields and version on create", async () => {
    const { client, calls } = fakeClient([taskRow()]);
    const repository = new PostgresTaskRepository(client);

    const created = await repository.create(task);

    expect(created).toEqual(task);
    expect(calls[0]?.text).toContain("INSERT INTO tasks");
    expect(calls[0]?.values?.[5]).toBe(JSON.stringify(task.plan));
    expect(calls[0]?.values?.[13]).toBe(1);
  });

  it("scopes reads to the task owner", async () => {
    const { client, calls } = fakeClient([]);
    const repository = new PostgresTaskRepository(client);

    expect(await repository.get({
      taskId: "task-1",
      userId: "user-1",
      companionId: "luoyao",
    })).toBeNull();
    expect(calls[0]?.values).toEqual(["task-1", "user-1", "luoyao"]);
  });

  it("uses optimistic version matching on update", async () => {
    const { client, calls } = fakeClient([
      taskRow({ status: "PAUSED", version: 2, updated_at: "2026-09-30T01:00:00.000Z" }),
    ]);
    const repository = new PostgresTaskRepository(client);

    const result = await repository.update({
      task: { ...task, status: "PAUSED", version: 2 },
      expectedVersion: 1,
    });

    expect(result.version).toBe(2);
    expect(calls[0]?.values?.[17]).toBe(1);
    expect(calls[0]?.text).toContain("AND version=$18");
  });

  it("turns a lost optimistic update into a concurrency error", async () => {
    const { client } = fakeClient([]);
    const repository = new PostgresTaskRepository(client);

    await expect(repository.update({
      task: { ...task, status: "PAUSED", version: 2 },
      expectedVersion: 1,
    })).rejects.toBeInstanceOf(TaskConcurrencyError);
  });

  it("claims a step atomically with a lease", async () => {
    const { client, calls } = fakeClient([
      taskRow({
        version: 2,
        execution_lease_id: "lease-1",
        execution_lease_expires_at: "2026-09-30T00:01:00.000Z",
      }),
    ]);
    const repository = new PostgresTaskRepository(client);

    const claimed = await repository.claimStep({
      task,
      leaseId: "lease-1",
      leaseExpiresAt: "2026-09-30T00:01:00.000Z",
      now: "2026-09-30T00:00:00.000Z",
    });

    expect(claimed.executionLeaseId).toBe("lease-1");
    expect(claimed.version).toBe(2);
    expect(calls[0]?.text).toContain("execution_lease_id=$4");
    expect(calls[0]?.text).toContain("execution_lease_expires_at <= $6::timestamptz");
  });

  it("distinguishes a non-running task from a lease conflict", async () => {
    const { client } = fakeClient([taskRow({ status: "PAUSED" })]);
    const repository = new PostgresTaskRepository(client);

    await expect(repository.claimStep({
      task: { ...task, status: "PAUSED" },
      leaseId: "lease-1",
      leaseExpiresAt: "2026-09-30T00:01:00.000Z",
      now: "2026-09-30T00:00:00.000Z",
    })).rejects.toBeInstanceOf(TaskLeaseError);
  });
});
