import { describe, expect, it } from "vitest";
import { canTransition, transition, transitionAfterApproval } from "./state-machine";

describe("task state machine", () => {
  it("allows normal execution", () => {
    expect(transition("PENDING", "PLANNING")).toBe("PLANNING");
    expect(transition("PLANNING", "RUNNING")).toBe("RUNNING");
    expect(transition("RUNNING", "COMPLETED")).toBe("COMPLETED");
  });

  it("rejects invalid transitions", () => {
    expect(canTransition("COMPLETED", "RUNNING")).toBe(false);
    expect(() => transition("COMPLETED", "RUNNING")).toThrow();
  });

  it("supports approval", () => {
    const task = {
      taskId: "task-1",
      userId: "user-1",
      companionId: "companion-1",
      goal: "run an approved task",
      status: "WAITING_APPROVAL" as const,
      plan: ["run"],
      currentStep: 0,
      requiresApproval: true,
      approvalStatus: "APPROVED" as const,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    expect(transitionAfterApproval(task)).toBe("RUNNING");
  });

  it("rejects direct approval transition bypass", () => {
    expect(canTransition("WAITING_APPROVAL", "RUNNING")).toBe(false);
    expect(() => transition("WAITING_APPROVAL", "RUNNING")).toThrow(
      "Approval transition requires transitionAfterApproval",
    );
  });

  it("rejects execution without explicit approval", () => {
    const task = {
      taskId: "task-2",
      userId: "user-1",
      companionId: "companion-1",
      goal: "run an unapproved task",
      status: "WAITING_APPROVAL" as const,
      plan: ["run"],
      currentStep: 0,
      requiresApproval: true,
      approvalStatus: "PENDING" as const,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    expect(() => transitionAfterApproval(task)).toThrow(
      "Task approval is required before execution",
    );
  });
});
