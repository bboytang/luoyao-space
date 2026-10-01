import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { migrationIds } from "./manifest";
import { MIGRATION_LOCK_KEY, runMigrations } from "./runner";

const databaseUrl = process.env.DATABASE_URL;

async function withSchema(run: (pool: Pool, client: PoolClient) => Promise<void>): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const client = await pool.connect();
  const schema = `migration_runner_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    await run(pool, client);
  } finally {
    await client.query("RESET search_path");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    client.release();
    await pool.end();
  }
}

describe("PostgreSQL migration runner", () => {
  it.skipIf(!databaseUrl)("applies a fresh schema in manifest order and records both historical 002 IDs", async () => {
    await withSchema(async (_pool, client) => {
      const result = await runMigrations(client);
      expect(result.applied).toEqual([...migrationIds]);
      expect(result.skipped).toEqual([]);

      const history = await client.query<{ migration_id: string; checksum: string; applied_at: Date }>(
        "SELECT migration_id, checksum, applied_at FROM schema_migrations ORDER BY applied_at, migration_id",
      );
      expect(history.rows.map((row) => row.migration_id).sort()).toEqual([...migrationIds].sort());
      expect(history.rows.filter((row) => row.migration_id.startsWith("002_"))).toHaveLength(2);
      for (const row of history.rows) {
        expect(row.checksum).toMatch(/^[a-f0-9]{64}$/);
        expect(row.applied_at).toBeInstanceOf(Date);
      }
      const tables = await client.query<{ name: string }>(
        "SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema()",
      );
      expect(tables.rows.map((row) => row.name).sort()).toEqual([
        "agent_tasks", "memories", "memory_event_queue", "schema_migrations", "task_event_log", "tasks",
      ]);
    });
  }, 30_000);

  it.skipIf(!databaseUrl)("skips all successfully applied migrations on a second run", async () => {
    await withSchema(async (_pool, client) => {
      await runMigrations(client);
      const result = await runMigrations(client);
      expect(result.applied).toEqual([]);
      expect(result.skipped).toEqual([...migrationIds]);
      const count = await client.query<{ count: string }>("SELECT count(*) FROM schema_migrations");
      expect(Number(count.rows[0]?.count)).toBe(6);
    });
  }, 30_000);

  it.skipIf(!databaseUrl)("rejects a changed checksum before applying another migration", async () => {
    await withSchema(async (_pool, client) => {
      await runMigrations(client);
      await client.query(
        "UPDATE schema_migrations SET checksum = $1 WHERE migration_id = $2",
        ["0".repeat(64), migrationIds[0]],
      );
      await expect(runMigrations(client)).rejects.toThrow(/checksum mismatch.*001_create_memories\.sql/i);
      const count = await client.query<{ count: string }>("SELECT count(*) FROM schema_migrations");
      expect(Number(count.rows[0]?.count)).toBe(6);
    });
  }, 30_000);

  it.skipIf(!databaseUrl)("does not record a failed migration as applied", async () => {
    await withSchema(async (_pool, client) => {
      await client.query("CREATE TABLE memories (id integer)");
      await expect(runMigrations(client)).rejects.toThrow();
      const history = await client.query<{ migration_id: string }>("SELECT migration_id FROM schema_migrations");
      expect(history.rows).toEqual([]);
    });
  }, 30_000);

  it.skipIf(!databaseUrl)("serializes concurrent runners with the database advisory lock", async () => {
    await withSchema(async (pool, client) => {
      const schema = (await client.query<{ schema: string }>("SELECT current_schema() AS schema")).rows[0]!.schema;
      const first = await pool.connect();
      const second = await pool.connect();
      let lockHeld = false;
      try {
        await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
        lockHeld = true;
        await first.query(`SET search_path TO "${schema}", public`);
        await second.query(`SET search_path TO "${schema}", public`);

        let firstFinished = false;
        let secondFinished = false;
        const firstRun = runMigrations(first).finally(() => { firstFinished = true; });
        const secondRun = runMigrations(second).finally(() => { secondFinished = true; });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(firstFinished).toBe(false);
        expect(secondFinished).toBe(false);

        await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
        lockHeld = false;
        const results = await Promise.all([firstRun, secondRun]);
        expect(results.map((result) => result.applied.length).sort()).toEqual([0, 6]);
        const count = await client.query<{ count: string }>("SELECT count(*) FROM schema_migrations");
        expect(Number(count.rows[0]?.count)).toBe(6);
      } finally {
        if (lockHeld) await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
        await Promise.allSettled([first.query("RESET search_path"), second.query("RESET search_path")]);
        first.release();
        second.release();
      }
    });
  }, 30_000);
});
