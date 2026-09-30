import { describe, expect, it } from "vitest";
import type { AgentTask } from "../../../packages/protocol/src/tasks";
import { InMemoryTaskEventPublisher } from "./events";
import { TaskLifecycleService } from "./lifecycle";
import { InMemoryTaskRepository } from "./repository";

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

describe("TaskLifecycleService", () => {
  it("creates a task and emits a minimal creation audit event", async () => {
    const repository = new InMemoryTaskRepository();
    const events = new InMemoryTaskEventPublisher();
    const service = new TaskLifecycleService(repository, events);

    const created = await service.create(task);

    expect(created.version).toBe(1);
    expect(events.events).toHaveLength(1);
    expect(events.events[0]?.type).toBe("task.created");
    expect(events.events[0]?.data.taskVersion).toBe(1);
  });

  it("persists a versioned transition and audits the persisted version", async () => {
    const repository = new InMemoryTaskRepository();
    const events = new InMemoryTaskEventPublisher();
    const service = new TaskLifecycleService(repository, events);

    await service.create(task);
    const next = {
      ...task,
      status: "PAUSED" as const,
      version: 2,
      updatedAt: "2026-09-30T01:00:00.000Z",
    };

    const persisted = await service.persistTransition({
      previous: task,
      next,
      eventType: "task.paused",
      actor: "user",
      source: "task-control",
    });

    expect(persisted.version).toBe(2);
    expect(events.events.map((event) => event.type)).toEqual([
      "task.created",
      "task.paused",
    ]);
    expect(events.events[1]?.data.taskVersion).toBe(2);
  });

  it("rejects transitions that skip a version", async () => {
    const service = new TaskLifecycleService(
      new InMemoryTaskRepository(),
      new InMemoryTaskEventPublisher(),
    );

    await expect(service.persistTransition({
      previous: task,
      next: { ...task, version: 3, status: "PAUSED" },
      eventType: "task.paused",
      actor: "system",
      source: "test",
    })).rejects.toThrow("Task transition must advance version exactly once");
  });
});
