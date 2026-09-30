import { describe, expect, it } from "vitest";
import type { AgentTask } from "../../../packages/protocol/src/tasks";
import {
  createTaskAuditEvent,
  InMemoryTaskEventPublisher,
} from "./events";

const task: AgentTask = {
  taskId: "task-1",
  userId: "user-1",
  companionId: "luoyao",
  goal: "完成项目",
  status: "RUNNING",
  plan: [{
    id: "step-1",
    capabilityId: "filesystem.write",
    description: "写文件",
    risk: "L1",
    requiredPermissions: ["filesystem.write"],
    requiresApproval: false,
    input: { content: "secret-content" },
  }],
  currentStep: 0,
  requiresApproval: false,
  deviceId: "desktop-1",
  version: 2,
  createdAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T01:00:00.000Z",
};

describe("task audit events", () => {
  it("creates a minimal lifecycle event without copying tool input", () => {
    const event = createTaskAuditEvent({
      task,
      type: "task.progress",
      actor: "agent",
      source: "task-runner",
      occurredAt: "2026-09-30T01:00:00.000Z",
      capabilityId: "filesystem.write",
    });

    expect(event).toMatchObject({
      type: "task.progress",
      version: 1,
      userId: "user-1",
      companionId: "luoyao",
      data: {
        taskId: "task-1",
        taskVersion: 2,
        status: "RUNNING",
        currentStep: 0,
        actor: "agent",
        capabilityId: "filesystem.write",
      },
    });
    expect(JSON.stringify(event)).not.toContain("secret-content");
  });

  it("publishes events to an in-memory collector", async () => {
    const publisher = new InMemoryTaskEventPublisher();
    const event = createTaskAuditEvent({
      task,
      type: "task.completed",
      actor: "agent",
      source: "task-runner",
    });

    await publisher.publish(event);

    expect(publisher.events).toHaveLength(1);
    expect(publisher.events[0]).toEqual(event);
  });
});
