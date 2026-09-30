import type { AgentTask } from "../../../packages/protocol/src/tasks";
import { transition } from "./state-machine";

export function pauseTask(task: AgentTask, now?: string): AgentTask {
  return updateStatus(task, "PAUSED", now);
}

export function requestUserInput(
  task: AgentTask,
  now?: string,
): AgentTask {
  return updateStatus(task, "WAITING_USER", now);
}

export function resumeTask(task: AgentTask, now?: string): AgentTask {
  if (task.status !== "PAUSED" && task.status !== "WAITING_USER") {
    throw new Error(
      `Task must be PAUSED or WAITING_USER to resume, got ${task.status}`,
    );
  }

  return {
    ...task,
    status: transition(task.status, "RUNNING"),
    error: undefined,
    version: task.version + 1,
    updatedAt: now ?? new Date().toISOString(),
  };
}

function updateStatus(
  task: AgentTask,
  target: "PAUSED" | "WAITING_USER",
  now?: string,
): AgentTask {
  return {
    ...task,
    status: transition(task.status, target),
    version: task.version + 1,
    updatedAt: now ?? new Date().toISOString(),
  };
}
