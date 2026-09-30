import { describe, expect, it } from "vitest";
import type { CapabilityDefinition } from "../../../packages/protocol/src/capabilities";
import type { AgentTask } from "../../../packages/protocol/src/tasks";
import { InMemoryTaskEventPublisher } from "./events";
import { TaskLifecycleService } from "./lifecycle";
import { executeDurableTaskStep } from "./durable-runner";
import { InMemoryTaskRepository } from "./repository";
import { ToolExecutionError } from "../../tool-runtime/src/runner";

const capabilities: CapabilityDefinition[] = [
  {
    id: "filesystem.write",
    description: "Write",
    inputSchema: {},
    outputSchema: {},
    risk: "L1",
    requiredPermissions: ["filesystem.write"],
    supportedRuntimes: ["desktop"],
  },
  {
    id: "browser.open",
    description: "Open",
    inputSchema: {},
    outputSchema: {},
    risk: "L0",
    requiredPermissions: ["browser.read"],
    supportedRuntimes: ["desktop"],
  },
];

const device = {
  deviceId: "desktop-1",
  userId: "user-1",
  runtime: "desktop" as const,
};

const permission = {
  autonomy: 1 as const,
  grantedPermissions: [],
  deviceId: "desktop-1",
  devicePermissions: {
    "desktop-1": ["filesystem.write", "browser.read"],
  },
  approvalGranted: false,
};

const task: AgentTask = {
  taskId: "task-1",
  userId: "user-1",
  companionId: "luoyao",
  goal: "完成两个动作",
  status: "RUNNING",
  plan: [
    {
      id: "step-1",
      capabilityId: "filesystem.write",
      description: "写文件",
      risk: "L1",
      requiredPermissions: ["filesystem.write"],
      requiresApproval: false,
      input: { path: "a.txt" },
    },
    {
      id: "step-2",
      capabilityId: "browser.open",
      description: "打开页面",
      risk: "L0",
      requiredPermissions: ["browser.read"],
      requiresApproval: false,
      input: { url: "https://example.com" },
    },
  ],
  currentStep: 0,
  requiresApproval: false,
  deviceId: "desktop-1",
  version: 1,
  createdAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T00:00:00.000Z",
};

const resolveCapability = (id: string) =>
  capabilities.find((capability) => capability.id === id);

function setup() {
  const repository = new InMemoryTaskRepository();
  const events = new InMemoryTaskEventPublisher();
  const lifecycle = new TaskLifecycleService(repository, events);
  return { repository, events, lifecycle };
}

describe("executeDurableTaskStep", () => {
  it("persists progress after exactly one successful step", async () => {
    const { repository, lifecycle, events } = setup();
    await lifecycle.create(task);

    const result = await executeDurableTaskStep({
      taskId: "task-1",
      userId: "user-1",
      companionId: "luoyao",
      device,
      repository,
      lifecycle,
      resolveCapability,
      permission,
      now: "2026-09-30T01:00:00.000Z",
      backend: {
        execute: async (invocation) => ({ capability: invocation.capabilityId }),
      },
    });

    expect(result.task.currentStep).toBe(1);
    expect(result.task.status).toBe("RUNNING");
    expect(result.task.version).toBe(3);
    expect(result.task.executionLeaseId).toBeUndefined();
    expect(result.task.result).toEqual([{ capability: "filesystem.write" }]);
    expect(events.events.map((event) => event.type)).toEqual([
      "task.created",
      "task.progress",
    ]);
  });

  it("resumes from persisted currentStep and completes", async () => {
    const { repository, lifecycle } = setup();
    await lifecycle.create(task);

    await executeDurableTaskStep({
      taskId: "task-1",
      userId: "user-1",
      companionId: "luoyao",
      device,
      repository,
      lifecycle,
      resolveCapability,
      permission,
      backend: {
        execute: async (invocation) => ({ capability: invocation.capabilityId }),
      },
    });

    const resumed = await executeDurableTaskStep({
      taskId: "task-1",
      userId: "user-1",
      companionId: "luoyao",
      device,
      repository,
      lifecycle,
      resolveCapability,
      permission,
      backend: {
        execute: async (invocation) => ({ capability: invocation.capabilityId }),
      },
    });

    expect(resumed.task.currentStep).toBe(2);
    expect(resumed.task.status).toBe("COMPLETED");
    expect(resumed.task.version).toBe(5);
    expect(resumed.task.result).toEqual([
      { capability: "filesystem.write" },
      { capability: "browser.open" },
    ]);
  });

  it("persists waiting-user without advancing currentStep", async () => {
    const { repository, lifecycle, events } = setup();
    await lifecycle.create(task);

    const result = await executeDurableTaskStep({
      taskId: "task-1",
      userId: "user-1",
      companionId: "luoyao",
      device,
      repository,
      lifecycle,
      resolveCapability,
      permission,
      backend: {
        execute: async () => {
          throw new ToolExecutionError("USER_INPUT_REQUIRED", "请选择目标文件");
        },
      },
    });

    expect(result.task.status).toBe("WAITING_USER");
    expect(result.task.currentStep).toBe(0);
    expect(result.task.version).toBe(3);
    expect(result.task.executionLeaseId).toBeUndefined();
    expect(events.events.at(-1)?.type).toBe("task.waiting_user");
  });
});


  it("does not execute the same step concurrently", async () => {
    const { repository, lifecycle } = setup();
    await lifecycle.create(task);
    let calls = 0;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });

    const first = executeDurableTaskStep({
      taskId: "task-1", userId: "user-1", companionId: "luoyao",
      device, repository, lifecycle, resolveCapability, permission,
      backend: {
        execute: async () => {
          calls += 1;
          await blocked;
          return { ok: true };
        },
      },
      now: "2026-09-30T01:00:00.000Z",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(executeDurableTaskStep({
      taskId: "task-1", userId: "user-1", companionId: "luoyao",
      device, repository, lifecycle, resolveCapability, permission,
      backend: { execute: async () => ({ ok: true }) },
      now: "2026-09-30T01:00:01.000Z",
    })).rejects.toMatchObject({ code: "TASK_CONCURRENCY_CONFLICT" });

    expect(calls).toBe(1);
    release();
    await first;
  });
