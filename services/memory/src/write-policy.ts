import type { MemoryKind } from "./ranking";

export type MemoryWriteDecision =
  | { action: "store"; kind: MemoryKind; importance: number; reason: string }
  | { action: "skip"; reason: string };

export interface MemoryWriteSignals {
  userMessage: string;
  explicitSaveRequest?: boolean;
  containsStablePreference?: boolean;
  containsPersonalFact?: boolean;
  containsDecision?: boolean;
  containsProjectContext?: boolean;
  emotionalSignificance?: number;
  relationshipSignificance?: number;
  taskSignificance?: number;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function decideMemoryWrite(signals: MemoryWriteSignals): MemoryWriteDecision {
  const content = signals.userMessage.trim();
  if (!content || content.length > 2000) return { action: "skip", reason: "invalid_candidate" };

  if (signals.explicitSaveRequest) {
    return { action: "store", kind: signals.containsDecision ? "decision" : "fact", importance: 1, reason: "explicit_request" };
  }
  if (signals.containsDecision) return { action: "store", kind: "decision", importance: 0.85, reason: "durable_decision" };
  if (signals.containsStablePreference) return { action: "store", kind: "preference", importance: 0.75, reason: "stable_preference" };
  if (signals.containsPersonalFact) return { action: "store", kind: "fact", importance: 0.7, reason: "personal_fact" };
  if (signals.containsProjectContext) return { action: "store", kind: "project", importance: 0.7, reason: "project_context" };

  if (clamp(signals.emotionalSignificance ?? 0) >= 0.8) {
    return { action: "store", kind: "emotion", importance: 0.75, reason: "high_emotional_significance" };
  }
  if (clamp(signals.relationshipSignificance ?? 0) >= 0.8) {
    return { action: "store", kind: "relationship", importance: 0.75, reason: "high_relationship_significance" };
  }
  if (clamp(signals.taskSignificance ?? 0) >= 0.8) {
    return { action: "store", kind: "task", importance: 0.7, reason: "high_task_significance" };
  }

  return { action: "skip", reason: "insufficient_long_term_value" };
}
