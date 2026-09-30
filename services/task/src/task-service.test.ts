import { describe, expect, it } from "vitest";
import { createTaskFromPlan } from "./task-service";
import type { TaskPlanStep } from "../../../packages/protocol/src/tasks";

const safeStep: TaskPlanStep = {
  id: "step-1",
  capabilityId: "browser.open",
  description: "打开页面",
  risk: "L1",
  requiredPermissions: ["browser.read"],
  requiresApproval: false,
  input: { url: "https://example.com" },
};

const approvalStep: TaskPlanStep = {
  id: "step-1",
  capabilityId: "filesystem.write",
  description: "写入文件",
  risk: "L2",
  requiredPermissions: ["filesystem.write"],
  requiresApproval: true,
  input: { path: "README.md", content: "test" },
};

describe("task creation from agent plan", () => {
  it("creates a runnable task for a plan that needs no approval", () => {
    const task = createTaskFromPlan({
      userId: "user-1",
      companionId: "luoyao",
      taskId: "task-1",
      now: "2026-09-29T00:00:00.000Z",
      plan: { goal: "打开项目页面", steps: [safeStep], requiresApproval: false },
    });

    expect(task).toMatchObject({
      taskId: "task-1",
      userId: "user-1",
      companionId: "luoyao",
      goal: "打开项目页面",
      status: "RUNNING",
      currentStep: 0,
      requiresApproval: false,
      createdAt: "2026-09-29T00:00:00.000Z",
      updatedAt: "2026-09-29T00:00:00.000Z",
    });
    expect(task.approvalStatus).toBeUndefined();
    expect(task.plan).toEqual([safeStep]);
  });

  it("creates an approval-waiting task for consequential plans", () => {
    const task = createTaskFromPlan({
      userId: "user-1",
      companionId: "luoyao",
      taskId: "task-2",
      plan: { goal: "修改项目", steps: [approvalStep], requiresApproval: true },
    });

    expect(task.status).toBe("WAITING_APPROVAL");
    expect(task.requiresApproval).toBe(true);
    expect(task.approvalStatus).toBe("PENDING");
  });

  it("rejects inconsistent approval metadata", () => {
    expect(() => createTaskFromPlan({
      userId: "user-1",
      companionId: "luoyao",
      plan: { goal: "修改项目", steps: [approvalStep], requiresApproval: false },
    })).toThrow("Task plan approval requirement is inconsistent");
  });

  it("does not share mutable plan arrays with the task", () => {
    const task = createTaskFromPlan({
      userId: "user-1",
      companionId: "luoyao",
      plan: { goal: "打开页面", steps: [safeStep], requiresApproval: false },
    });

    expect(task.plan).not.toBe([safeStep]);
    expect(task.plan[0].requiredPermissions).not.toBe(safeStep.requiredPermissions);
  });

  it("rejects an empty plan", () => {
    expect(() => createTaskFromPlan({
      userId: "user-1",
      companionId: "luoyao",
      plan: { goal: "空任务", steps: [], requiresApproval: false },
    })).toThrow("Task plan must contain at least one step");
  });
});
