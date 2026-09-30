import { describe, expect, it } from "vitest";
import type { AgentTask } from "../../../packages/protocol/src/tasks";
import { pauseTask, requestUserInput, resumeTask } from "./task-control";

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
  createdAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T00:00:00.000Z",
};

describe("task control", () => {
  it("pauses a running task without changing its step", () => {
    const paused = pauseTask(task, "2026-09-30T01:00:00.000Z");

    expect(paused).toMatchObject({
      status: "PAUSED",
      currentStep: 0,
      updatedAt: "2026-09-30T01:00:00.000Z",
    });
    expect(task.status).toBe("RUNNING");
  });

  it("moves a running task to waiting for user input", () => {
    const waiting = requestUserInput(task, "2026-09-30T01:01:00.000Z");

    expect(waiting).toMatchObject({
      status: "WAITING_USER",
      currentStep: 0,
      updatedAt: "2026-09-30T01:01:00.000Z",
    });
  });

  it("resumes a paused task at the same step", () => {
    const paused = pauseTask(task);
    const resumed = resumeTask({
      ...paused,
      error: "temporarily paused",
      currentStep: 0,
    }, "2026-09-30T01:02:00.000Z");

    expect(resumed).toMatchObject({
      status: "RUNNING",
      currentStep: 0,
      updatedAt: "2026-09-30T01:02:00.000Z",
    });
    expect(resumed.error).toBeUndefined();
  });

  it("resumes a waiting task at the same step", () => {
    const waiting = requestUserInput(task);
    const resumed = resumeTask(waiting);

    expect(resumed.status).toBe("RUNNING");
    expect(resumed.currentStep).toBe(0);
  });

  it("rejects pausing a non-running task", () => {
    expect(() => pauseTask({ ...task, status: "COMPLETED" })).toThrow(
      "Invalid task transition",
    );
  });

  it("rejects waiting for user from a paused task", () => {
    expect(() => requestUserInput({ ...task, status: "PAUSED" })).toThrow(
      "Invalid task transition",
    );
  });

  it("rejects resume from an unrelated terminal state", () => {
    expect(() => resumeTask({ ...task, status: "COMPLETED" })).toThrow(
      "Task must be PAUSED or WAITING_USER to resume",
    );
  });
});
