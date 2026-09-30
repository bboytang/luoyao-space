import { describe, expect, it } from "vitest";
import type { SqlClient } from "./postgres-repository";
import {
  createTaskAuditEvent,
  type TaskAuditEvent,
} from "./events";
import { PostgresTaskEventPublisher } from "./postgres-event-publisher";

function fakeClient() {
  const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  const client: SqlClient = {
    async query(text, values) {
      calls.push({ text, values });
      return { rows: [] };
    },
  };
  return { client, calls };
}

const event: TaskAuditEvent = createTaskAuditEvent({
  task: {
    taskId: "task-1",
    userId: "user-1",
    companionId: "luoyao",
    goal: "完成项目",
    status: "COMPLETED",
    plan: [],
    currentStep: 1,
    requiresApproval: false,
    version: 3,
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T01:00:00.000Z",
  },
  type: "task.completed",
  actor: "agent",
  source: "task-runner",
  eventId: "00000000-0000-0000-0000-000000000003",
});

describe("PostgresTaskEventPublisher", () => {
  it("persists a versioned task audit event with idempotent insert", async () => {
    const { client, calls } = fakeClient();
    await new PostgresTaskEventPublisher(client).publish(event);

    expect(calls[0]?.text).toContain("INSERT INTO task_event_log");
    expect(calls[0]?.text).toContain("ON CONFLICT (event_id) DO NOTHING");
    expect(calls[0]?.values?.[1]).toBe("task-1");
    expect(calls[0]?.values?.[5]).toBe(1);
    expect(calls[0]?.values?.[9]).toBe(JSON.stringify(event.data));
  });
});
