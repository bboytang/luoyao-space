import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSION, EmbeddingError } from "./embedding";
import { PostgresMemoryRepository, type SqlClient } from "./postgres-repository";

type QueryCall = [string, readonly unknown[] | undefined];
const databaseUrl = process.env.DATABASE_URL;

function makeClient(query: ReturnType<typeof vi.fn>): SqlClient {
  return { query } as unknown as SqlClient;
}

describe("PostgresMemoryRepository", () => {
  it("creates a memory through parameterized SQL", async () => {
    const query = vi.fn(async (_sql: string, _values?: readonly unknown[]) => ({
      rows: [{
        id: "00000000-0000-0000-0000-000000000001",
        user_id: "u1", companion_id: "c1", kind: "fact",
        content: "喜欢短回复", importance: 0.8,
        relationship_relevance: 0.4, project_relevance: 0,
        created_at: "2026-09-30T00:00:00.000Z",
        last_accessed_at: null, embedding_score: null,
      }],
    }));

    const repository = new PostgresMemoryRepository(makeClient(query));
    const memory = await repository.create({
      userId: "u1", companionId: "c1", kind: "fact",
      content: "喜欢短回复", importance: 0.8, embedding: Array.from({ length: EMBEDDING_DIMENSION }, (_, index) => index / EMBEDDING_DIMENSION),
    });

    expect(memory.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(query).toHaveBeenCalledOnce();
    const calls = query.mock.calls as unknown as QueryCall[];
    const values = calls[0]?.[1] ?? [];
    expect(values[0]).toBe("u1");
    expect(values[8]).toBe("[" + Array.from({ length: EMBEDDING_DIMENSION }, (_, index) => index / EMBEDDING_DIMENSION).join(",") + "]");
  });

  it("uses vector similarity when a query embedding is supplied", async () => {
    const query = vi.fn(async (_sql: string, _values?: readonly unknown[]) => ({
      rows: [],
    }));
    const repository = new PostgresMemoryRepository(makeClient(query));

    await repository.findCandidates({
      userId: "u1", companionId: "c1", query: "project",
      queryEmbedding: Array.from({ length: EMBEDDING_DIMENSION }, (_, index) => index / EMBEDDING_DIMENSION), limit: 8,
      now: "2026-09-30T00:00:00.000Z",
      relationshipWeight: 1, projectWeight: 1,
    });

    const calls = query.mock.calls as unknown as QueryCall[];
    const sql = calls[0]?.[0] ?? "";
    const values = calls[0]?.[1] ?? [];
    expect(sql).toContain("embedding <=> $6::vector");
    expect(values[5]).toBe("[" + Array.from({ length: EMBEDDING_DIMENSION }, (_, index) => index / EMBEDDING_DIMENSION).join(",") + "]");
  });

  it("does not issue an update for an empty access set", async () => {
    const query = vi.fn(async (_sql: string, _values?: readonly unknown[]) => ({
      rows: [],
    }));
    const repository = new PostgresMemoryRepository(makeClient(query));

    await repository.markAccessed([], "2026-09-30T00:00:00.000Z");
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a wrong-dimension embedding before issuing SQL", async () => {
    const query = vi.fn(async (_sql: string, _values?: readonly unknown[]) => ({
      rows: [],
    }));
    const repository = new PostgresMemoryRepository(makeClient(query));

    await expect(repository.create({
      userId: "u1",
      companionId: "c1",
      kind: "fact",
      content: "维度错误",
      embedding: [0, 1],
    })).rejects.toThrow(EmbeddingError);

    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a wrong-dimension query embedding before issuing SQL", async () => {
    const query = vi.fn(async (_sql: string, _values?: readonly unknown[]) => ({
      rows: [],
    }));
    const repository = new PostgresMemoryRepository(makeClient(query));

    await expect(repository.findCandidates({
      userId: "u1",
      companionId: "c1",
      query: "project",
      queryEmbedding: [0, 1],
      limit: 8,
      now: "2026-09-30T00:00:00.000Z",
      relationshipWeight: 1,
      projectWeight: 1,
    })).rejects.toThrow(EmbeddingError);

    expect(query).not.toHaveBeenCalled();
  });

});

describe("PostgresMemoryRepository with PostgreSQL", () => {
  it.skipIf(!databaseUrl)("persists and reads a memory by projectId", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();
    const schema = `memory_project_${randomUUID().replaceAll("-", "")}`;

    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}", public`);
      for (const migration of ["001_create_memories.sql", "005_add_memory_project_scope.sql"]) {
        const sql = await readFile(new URL(`../../../database/migrations/${migration}`, import.meta.url), "utf8");
        await client.query(sql);
      }

      const repository = new PostgresMemoryRepository(client);
      const userId = randomUUID();
      const companionId = randomUUID();
      const projectId = randomUUID();
      const created = await repository.create({
        userId, companionId, projectId, kind: "project", content: "Project-scoped memory",
      });
      const memories = await repository.findProjectMemories({ userId, companionId, projectId, limit: 10 });

      expect(created.projectId).toBe(projectId);
      expect(memories).toHaveLength(1);
      expect(memories[0]?.id).toBe(created.id);
      expect(memories[0]?.projectId).toBe(projectId);
    } finally {
      await client.query("RESET search_path");
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      client.release();
      await pool.end();
    }
  });
});
