import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEMORY_RETENTION_POLICY,
  evaluateMemoryRetention,
  type MemoryRetentionPolicy,
} from "./lifecycle";
import type { MemoryRecord } from "./ranking";

const base: MemoryRecord = {
  id: "m1",
  userId: "u1",
  companionId: "c1",
  kind: "event",
  content: "memory",
  importance: 0.5,
  relationshipRelevance: 0,
  projectRelevance: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("memory retention policy", () => {
  it("retains important memories regardless of age", () => {
    expect(
      evaluateMemoryRetention(
        { ...base, importance: 0.95 },
        "2028-01-01T00:00:00.000Z",
      ),
    ).toEqual({ action: "retain", reason: "protected_importance" });
  });

  it("uses last access as the retention reference point", () => {
    const memory = {
      ...base,
      createdAt: "2026-01-01T00:00:00.000Z",
      lastAccessedAt: "2026-08-01T00:00:00.000Z",
    };

    expect(
      evaluateMemoryRetention(memory, "2026-09-01T00:00:00.000Z"),
    ).toEqual({ action: "retain", reason: "within_retention_window" });
  });

  it("marks an old memory eligible after its kind-specific window", () => {
    const memory = {
      ...base,
      kind: "task" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    expect(
      evaluateMemoryRetention(memory, "2026-04-02T00:00:00.000Z"),
    ).toEqual({
      action: "eligible",
      reason: "retention_window_expired",
      eligibleSince: "2026-04-01T00:00:00.000Z",
    });
  });

  it("falls back to the default window for kinds without an explicit rule", () => {
    const policy: MemoryRetentionPolicy = {
      maxAgeMsByKind: {},
      defaultMaxAgeMs: 30 * 86_400_000,
      protectedImportanceThreshold: 0.95,
    };

    expect(
      evaluateMemoryRetention(
        { ...base, kind: "event", createdAt: "2026-01-01T00:00:00.000Z" },
        "2026-02-01T00:00:01.000Z",
        policy,
      ).action,
    ).toBe("eligible");
  });

  it("fails safe when timestamps are invalid", () => {
    expect(
      evaluateMemoryRetention(
        { ...base, createdAt: "not-a-date" },
        "2026-09-30T00:00:00.000Z",
      ),
    ).toEqual({ action: "retain", reason: "invalid_timestamp" });
  });

  it("uses the current default policy for durable memory kinds", () => {
    expect(DEFAULT_MEMORY_RETENTION_POLICY.maxAgeMsByKind.fact).toBe(365 * 86_400_000);
    expect(DEFAULT_MEMORY_RETENTION_POLICY.maxAgeMsByKind.task).toBe(90 * 86_400_000);
    expect(DEFAULT_MEMORY_RETENTION_POLICY.protectedImportanceThreshold).toBe(0.95);
  });
});
