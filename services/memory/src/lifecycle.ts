import type { MemoryKind, MemoryRecord } from "./ranking";

export interface MemoryRetentionPolicy {
  maxAgeMsByKind: Readonly<Partial<Record<MemoryKind, number>>>;
  defaultMaxAgeMs: number;
  protectedImportanceThreshold: number;
}

export type MemoryRetentionDecision =
  | { action: "retain"; reason: "protected_importance" | "within_retention_window" | "invalid_timestamp" }
  | { action: "eligible"; reason: "retention_window_expired"; eligibleSince: string };

const DAY_MS = 86_400_000;

export const DEFAULT_MEMORY_RETENTION_POLICY: MemoryRetentionPolicy = {
  maxAgeMsByKind: {
    fact: 365 * DAY_MS,
    preference: 365 * DAY_MS,
    decision: 365 * DAY_MS,
    relationship: 365 * DAY_MS,
    shared_history: 365 * DAY_MS,
    project: 180 * DAY_MS,
    goal: 180 * DAY_MS,
    task: 90 * DAY_MS,
    event: 180 * DAY_MS,
    episode: 180 * DAY_MS,
    emotion: 180 * DAY_MS,
  },
  defaultMaxAgeMs: 180 * DAY_MS,
  protectedImportanceThreshold: 0.95,
};

function timestampMs(value: string): number {
  return new Date(value).getTime();
}

export function evaluateMemoryRetention(
  memory: MemoryRecord,
  now: string,
  policy: MemoryRetentionPolicy = DEFAULT_MEMORY_RETENTION_POLICY,
): MemoryRetentionDecision {
  const nowMs = timestampMs(now);
  const referenceAt = memory.lastAccessedAt ?? memory.createdAt;
  const referenceMs = timestampMs(referenceAt);

  if (!Number.isFinite(nowMs) || !Number.isFinite(referenceMs)) {
    return { action: "retain", reason: "invalid_timestamp" };
  }

  if (memory.importance >= policy.protectedImportanceThreshold) {
    return { action: "retain", reason: "protected_importance" };
  }

  const maxAgeMs = policy.maxAgeMsByKind[memory.kind] ?? policy.defaultMaxAgeMs;
  const eligibleAtMs = referenceMs + maxAgeMs;

  if (nowMs < eligibleAtMs) {
    return { action: "retain", reason: "within_retention_window" };
  }

  return {
    action: "eligible",
    reason: "retention_window_expired",
    eligibleSince: new Date(eligibleAtMs).toISOString(),
  };
}
