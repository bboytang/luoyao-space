import { describe, expect, it } from "vitest";
import type { CapabilityDefinition } from "../../../packages/protocol/src/capabilities";
import type { AgentTask } from "../../../packages/protocol/src/tasks";
import { ToolExecutionError } from "../../tool-runtime/src/runner";
import { InMemoryTaskEventPublisher } from "./events";
import { TaskLifecycleService } from "./lifecycle";
import { InMemoryTaskRepository } from "./repository";
import { executeTask } from "./task-runner";
import { resumeTask } from "./task-control";

const capabilities: CapabilityDefinition[] = [
  {
    id: "filesystem.write",
    description: "Write a file",
    inputSchema: {},
    outputSchema: {},
    risk: "L1",
    requiredPermissions: ["filesystem.write"],
    supportedRuntimes: ["desktop"],
  },
  {
    id: "browser.open",
    description: "Open a page",
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
  version: 1,
  deviceId: "desktop-1",
  createdAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T00:00:00.000Z",
};

function setup() {
  const repository = new InMemoryTaskRepository();
  const events = new InMemoryTaskEventPublisher();
  const lifecycle = new TaskLifecycleService(repository, events);
  return { repository, events, lifecycle };
}

const resolveCapability = (id: string) =>
  capabilities.find((capability) => capability.id === id);

async function createTask(
  lifecycle: TaskLifecycleService,
  input: AgentTask = task,
): Promise<AgentTask> {
  return lifecycle.create(input);
}

describe("executeTask", () => {
  it("persists every step and completes the task", async () => {
    const { repository, lifecycle, events } = setup();
    await createTask(lifecycle);
    const invocations: string[] = [];

    const result = await executeTask({
      task,
      device,
      repository,
      lifecycle,
      permission,
      resolveCapability,
      now: "2026-09-30T01:00:00.000Z",
      backend: {
        execute: async (invocation) => {
          invocations.push(invocation.capabilityId);
          return { capability: invocation.capabilityId };
        },
      },
    });

    expect(invocations).toEqual(["filesystem.write", "browser.open"]);
    expect(result.task.status).toBe("COMPLETED");
    expect(result.task.currentStep).toBe(2);
    expect(result.task.version).toBe(5);
    expect(result.task.result).toEqual([
      { capability: "filesystem.write" },
      { capability: "browser.open" },
    ]);
    expect(result.task.updatedAt).toBe("2026-09-30T01:00:00.000Z");
    expect(events.events.map((event) => event.type)).toEqual([
      "task.created",
      "task.progress",
      "task.completed",
    ]);

    const persisted = await repository.get({
      taskId: task.taskId,
      userId: task.userId,
      companionId: task.companionId,
    });
    expect(persisted).toMatchObject({
      status: "COMPLETED",
      currentStep: 2,
      version: 5,
    });
  });

  it("fails immediately when a capability cannot be resolved", async () => {
    const { repository, lifecycle } = setup();
    const missingTask = {
      ...task,
      plan: [{ ...task.plan[0], capabilityId: "missing.capability" }],
    };
    await createTask(lifecycle, missingTask);

    const result = await executeTask({
      task: missingTask,
      device,
      repository,
      lifecycle,
      permission,
      resolveCapability,
      backend: {
        execute: async () => {
          throw new Error("must not execute");
        },
      },
      now: "2026-09-30T01:01:00.000Z",
    });

    expect(result.task.status).toBe("FAILED");
    expect(result.task.error).toBe("capability_not_found:missing.capability");
    expect(result.task.version).toBe(3);
  });

  it("fails at the first tool error and does not run later steps", async () => {
    const { repository, lifecycle } = setup();
    await createTask(lifecycle);
    let calls = 0;

    const result = await executeTask({
      task,
      device,
      repository,
      lifecycle,
      permission,
      resolveCapability,
      backend: {
        execute: async () => {
          calls += 1;
          throw new Error("backend unavailable");
        },
      },
    });

    expect(calls).toBe(1);
    expect(result.stepResults).toHaveLength(1);
    expect(result.task.status).toBe("FAILED");
    expect(result.task.currentStep).toBe(0);
    expect(result.task.error).toBe("backend unavailable");
    expect(result.task.version).toBe(3);
  });

  it("rejects a non-running task before execution", async () => {
    const { repository, lifecycle } = setup();
    const paused = { ...task, status: "PAUSED" as const };
    await createTask(lifecycle, paused);

    await expect(
      executeTask({
        task: paused,
        device,
        repository,
        lifecycle,
        permission,
        resolveCapability,
        backend: { execute: async () => ({}) },
      }),
    ).rejects.toThrow("Task must be RUNNING");
  });

  it("waits for user input without advancing the current step", async () => {
    const { repository, lifecycle } = setup();
    await createTask(lifecycle);

    const result = await executeTask({
      task,
      device,
      repository,
      lifecycle,
      permission,
      resolveCapability,
      backend: {
        execute: async () => {
          throw new ToolExecutionError(
            "USER_INPUT_REQUIRED",
            "请选择目标文件",
          );
        },
      },
      now: "2026-09-30T01:03:00.000Z",
    });

    expect(result.stepResults).toHaveLength(1);
    expect(result.task.status).toBe("WAITING_USER");
    expect(result.task.currentStep).toBe(0);
    expect(result.task.version).toBe(3);
    expect(result.task.updatedAt).toBe("2026-09-30T01:03:00.000Z");
  });

  it("resumes from the persisted step after user input is supplied", async () => {
    const { repository, lifecycle } = setup();

    const waiting = await createTask(lifecycle);
    const waitingResult = await executeTask({
      task: waiting,
      device,
      repository,
      lifecycle,
      permission,
      resolveCapability,
      backend: {
        execute: async () => {
          throw new ToolExecutionError(
            "USER_INPUT_REQUIRED",
            "请选择目标文件",
          );
        },
      },
    });

    const resumedTask = resumeTask(
      waitingResult.task,
      "2026-09-30T01:04:00.000Z",
    );
    const persistedResumed = await lifecycle.persistTransition({
      previous: waitingResult.task,
      next: resumedTask,
      eventType: "task.resumed",
      actor: "user",
      source: "task-control",
    });

    const resumed = await executeTask({
      task: persistedResumed,
      device,
      repository,
      lifecycle,
      permission,
      resolveCapability,
      backend: {
        execute: async (invocation) => ({
          completed: invocation.capabilityId,
        }),
      },
      now: "2026-09-30T01:05:00.000Z",
    });

    expect(resumed.task.status).toBe("COMPLETED");
    expect(resumed.task.currentStep).toBe(2);
    expect(resumed.task.version).toBe(8);
  });

  it("rejects a stale task snapshot before execution", async () => {
    const { repository, lifecycle } = setup();
    await createTask(lifecycle);

    await expect(
      executeTask({
        task: { ...task, version: 0 },
        device,
        repository,
        lifecycle,
        permission,
        resolveCapability,
        backend: { execute: async () => ({}) },
      }),
    ).rejects.toMatchObject({ code: "TASK_CONCURRENCY_CONFLICT" });
  });

  it("does not let task approval bypass runtime permission checks", async () => {
    const approvedTask = {
      ...task,
      plan: [{
        ...task.plan[0],
        risk: "L2" as const,
        requiresApproval: true,
      }],
      requiresApproval: true,
      approvalStatus: "APPROVED" as const,
    };
    const { repository, lifecycle } = setup();
    await createTask(lifecycle, approvedTask);

    const result = await executeTask({
      task: approvedTask,
      device,
      repository,
      lifecycle,
      permission: { ...permission, autonomy: 1 },
      resolveCapability: () => ({
        ...capabilities[0],
        risk: "L2",
      }),
      backend: {
        execute: async () => {
          throw new Error("must not execute");
        },
      },
    });

    expect(result.task.status).toBe("FAILED");
    expect(result.task.error).toBe("autonomy_level_too_low");
    expect(result.task.version).toBe(3);
  });
});
