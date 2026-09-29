import { describe, expect, it } from "vitest";
import { canTransition, transition } from "./state-machine";

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
    expect(transition("PLANNING", "WAITING_APPROVAL")).toBe("WAITING_APPROVAL");
    expect(transition("WAITING_APPROVAL", "RUNNING")).toBe("RUNNING");
  });
});
