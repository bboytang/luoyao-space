import type { MemoryKind, MemoryRecord } from "./ranking";

export type ConsolidationAction =
  | "store"
  | "skip_duplicate"
  | "replace_existing"
  | "keep_both";

export interface ConsolidationCandidate {
  kind: MemoryKind;
  content: string;
  importance: number;
  embeddingScore?: number;
}

export interface ConsolidationResult {
  action: ConsolidationAction;
  reason: string;
  existingId?: string;
}

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function consolidateMemory(
  candidate: ConsolidationCandidate,
  existing: readonly MemoryRecord[],
): ConsolidationResult {
  const candidateText = normalizeText(candidate.content);
  if (!candidateText) return { action: "skip_duplicate", reason: "empty_candidate" };

  const sameKind = existing.filter((memory) => memory.kind === candidate.kind);

  const exact = sameKind.find(
    (memory) => normalizeText(memory.content) === candidateText,
  );
  if (exact) {
    return {
      action: "skip_duplicate",
      reason: "exact_duplicate",
      existingId: exact.id,
    };
  }

  const similar = sameKind
    .filter((memory) => (memory.embeddingScore ?? 0) >= 0.92)
    .sort((a, b) => b.importance - a.importance)[0];

  if (!similar) {
    return { action: "store", reason: "no_similar_memory" };
  }

  if (candidate.kind === "preference" || candidate.kind === "decision" || candidate.kind === "fact") {
    if (candidate.importance >= similar.importance) {
      return {
        action: "replace_existing",
        reason: "newer_or_stronger_durable_memory",
        existingId: similar.id,
      };
    }

    return {
      action: "keep_both",
      reason: "existing_memory_is_stronger",
      existingId: similar.id,
    };
  }

  return {
    action: "keep_both",
    reason: "similar_memory_without_replacement_rule",
    existingId: similar.id,
  };
}
