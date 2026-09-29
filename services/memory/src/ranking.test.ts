import { describe, expect, it } from "vitest";
import { rankMemories, type MemoryRecord } from "./ranking";

const base: MemoryRecord = {
  id: "m",
  userId: "u",
  companionId: "c",
  kind: "fact",
  content: "memory",
  importance: 0.5,
  relationshipRelevance: 0.5,
  projectRelevance: 0.5,
  createdAt: "2026-09-29T00:00:00Z",
};

describe("rankMemories", () => {
  it("prioritizes semantic relevance while retaining recency and importance", () => {
    const result = rankMemories(
      [
        { ...base, id: "semantic", embeddingScore: 1, createdAt: "2026-09-28T00:00:00Z" },
        { ...base, id: "old", embeddingScore: 0.2, createdAt: "2026-06-01T00:00:00Z", importance: 1 },
      ],
      {
        now: "2026-09-29T00:00:00Z",
        query: "project",
        relationshipWeight: 1,
        projectWeight: 1,
      },
    );

    expect(result.map((memory) => memory.id)).toEqual(["semantic", "old"]);
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it("applies relationship and project weights as bounded modifiers", () => {
    const relationship = {
      ...base,
      id: "relationship",
      embeddingScore: 0.5,
      relationshipRelevance: 1,
      projectRelevance: 0,
    };
    const project = {
      ...base,
      id: "project",
      embeddingScore: 0.5,
      relationshipRelevance: 0,
      projectRelevance: 1,
    };

    const result = rankMemories(
      [project, relationship],
      {
        now: "2026-09-29T00:00:00Z",
        query: "project",
        relationshipWeight: 2,
        projectWeight: 0,
      },
    );

    expect(result[0].id).toBe("relationship");
  });

  it("handles invalid timestamps without producing NaN", () => {
    const result = rankMemories(
      [{ ...base, createdAt: "not-a-date" }],
      { now: "2026-09-29T00:00:00Z", query: "anything", relationshipWeight: 1, projectWeight: 1 },
    );

    expect(Number.isFinite(result[0].score)).toBe(true);
  });

  it("clamps malformed relevance values instead of producing invalid scores", () => {
    const result = rankMemories(
      [{ ...base, embeddingScore: 99, importance: -10 }],
      {
        now: "2026-09-29T00:00:00Z",
        query: "anything",
        relationshipWeight: 1,
        projectWeight: 1,
      },
    );

    expect(Number.isFinite(result[0].score)).toBe(true);
    expect(result[0].score).toBeGreaterThanOrEqual(0);
    expect(result[0].score).toBeLessThanOrEqual(1);
  });
});
