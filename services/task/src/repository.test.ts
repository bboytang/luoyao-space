import { describe, expect, it } from "vitest";
import type { AgentTask } from "../../../packages/protocol/src/tasks";
import {
  InMemoryTaskRepository, TaskConcurrencyError, TaskLeaseError,
} from "./repository";

const task: AgentTask = {
  taskId: "task-1", userId: "user-1", companionId: "luoyao", goal: "完成项目",
  status: "RUNNING",
  plan: [{ id: "step-1", capabilityId: "test.run", description: "执行", risk: "L1",
    requiredPermissions: [], requiresApproval: false, input: {} }],
  currentStep: 0, requiresApproval: false, deviceId: "desktop-1", version: 1,
  createdAt: "2026-09-30T00:00:00.000Z", updatedAt: "2026-09-30T00:00:00.000Z",
};

describe("InMemoryTaskRepository", () => {
  it("creates and scopes task reads by user and companion", async () => {
    const repository = new InMemoryTaskRepository();
    const created = await repository.create(task);
    expect(created.version).toBe(1);
    expect(await repository.get({ taskId:"task-1",userId:"user-1",companionId:"luoyao" })).toEqual(created);
    expect(await repository.get({ taskId:"task-1",userId:"other-user",companionId:"luoyao" })).toBeNull();
  });

  it("increments version on update", async () => {
    const repository = new InMemoryTaskRepository();
    await repository.create(task);
    const updated = await repository.update({
      task:{...task,status:"PAUSED",updatedAt:"2026-09-30T01:00:00.000Z",version:2},
      expectedVersion:1,
    });
    expect(updated.version).toBe(2);
    expect(updated.status).toBe("PAUSED");
  });

  it("rejects stale concurrent updates", async () => {
    const repository = new InMemoryTaskRepository();
    await repository.create(task);
    const first = await repository.get({taskId:"task-1",userId:"user-1",companionId:"luoyao"});
    const second = await repository.get({taskId:"task-1",userId:"user-1",companionId:"luoyao"});
    await repository.update({task:{...first!,status:"PAUSED",version:2},expectedVersion:1});
    await expect(repository.update({task:{...second!,status:"CANCELLED",version:2},expectedVersion:1}))
      .rejects.toBeInstanceOf(TaskConcurrencyError);
  });

  it("claims a running step and prevents a second active claimant", async () => {
    const repository = new InMemoryTaskRepository();
    await repository.create(task);
    const loaded = await repository.get({taskId:"task-1",userId:"user-1",companionId:"luoyao"});
    const claimed = await repository.claimStep({
      task: loaded!, leaseId:"lease-1", leaseExpiresAt:"2026-09-30T00:01:00.000Z",
      now:"2026-09-30T00:00:00.000Z",
    });
    expect(claimed.executionLeaseId).toBe("lease-1");
    expect(claimed.version).toBe(2);
    await expect(repository.claimStep({
      task: {...loaded!}, leaseId:"lease-2", leaseExpiresAt:"2026-09-30T00:01:00.000Z",
      now:"2026-09-30T00:00:01.000Z",
    })).rejects.toBeInstanceOf(TaskConcurrencyError);
  });

  it("allows a claim after the lease expires", async () => {
    const repository = new InMemoryTaskRepository();
    await repository.create(task);
    const loaded = await repository.get({taskId:"task-1",userId:"user-1",companionId:"luoyao"});
    await repository.claimStep({
      task: loaded!, leaseId:"lease-1", leaseExpiresAt:"2026-09-30T00:01:00.000Z",
      now:"2026-09-30T00:00:00.000Z",
    });
    const expiredView = await repository.get({taskId:"task-1",userId:"user-1",companionId:"luoyao"});
    const reclaimed = await repository.claimStep({
      task: expiredView!, leaseId:"lease-2", leaseExpiresAt:"2026-09-30T00:02:00.000Z",
      now:"2026-09-30T00:01:01.000Z",
    });
    expect(reclaimed.executionLeaseId).toBe("lease-2");
    expect(reclaimed.version).toBe(3);
  });

  it("returns detached task objects", async () => {
    const repository = new InMemoryTaskRepository();
    const created = await repository.create(task);
    created.plan[0]!.requiredPermissions.push("mutated");
    const loaded = await repository.get({taskId:"task-1",userId:"user-1",companionId:"luoyao"});
    expect(loaded?.plan[0]?.requiredPermissions).toEqual([]);
  });
});
