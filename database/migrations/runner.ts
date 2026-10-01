import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import type { PoolClient } from "pg";
import { migrationIds, validateMigrationManifest } from "./manifest";
import { assertHistoryTableShape, assertSchemaMatchesHistory, readSchemaCatalog } from "./schema-guard";

// A database-wide session lock serializes runners, including the initial history-table creation.
export const MIGRATION_LOCK_KEY = 1_789_660_832;

/** The caller must supply a dedicated connection and release it after this promise settles. */
export async function runMigrations(client: PoolClient): Promise<{ applied: string[]; skipped: string[] }> {
  const directory = new URL(".", import.meta.url);
  const sqlFiles = (await readdir(directory)).filter((file) => file.endsWith(".sql"));
  validateMigrationManifest(migrationIds, sqlFiles);

  const migrations = await Promise.all(migrationIds.map(async (id) => {
    const sql = await readFile(new URL(id, directory), "utf8");
    return { id, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  }));

  await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
  try {
    const schemaResult = await client.query<{ schema: string | null }>("SELECT current_schema() AS schema");
    const schema = schemaResult.rows[0]?.schema;
    if (!schema) throw new Error("Migration target schema is not set in search_path");
    if (schema.startsWith("pg_temp_") || schema.startsWith("pg_toast") ||
        schema === "pg_catalog" || schema === "information_schema") {
      throw new Error(`Temporary migration target schema or system schema is not allowed: ${schema}`);
    }
    const historyTable = `"${schema.replaceAll('"', '""')}".schema_migrations`;
    const existingCatalog = await readSchemaCatalog(client, schema);
    const historyKind = existingCatalog.relations.get("schema_migrations");
    if (historyKind && historyKind !== "r") {
      throw new Error(`Migration history object in schema ${schema} is not a table`);
    }
    if (!historyKind && [...existingCatalog.relations.values()].some((kind) => kind !== "i" && kind !== "I")) {
      throw new Error(`Existing schema ${schema} has objects without migration history; operator-controlled adoption is required`);
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_id TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await assertHistoryTableShape(client, schema);

    const history = await client.query<{ migration_id: string; checksum: string }>(
      `SELECT migration_id, checksum FROM ${historyTable}`,
    );
    const appliedChecksums = new Map(history.rows.map((row) => [row.migration_id, row.checksum]));
    if (appliedChecksums.size !== history.rows.length) {
      throw new Error("Migration history contains duplicate IDs");
    }
    if (history.rows.length === 0 && [...existingCatalog.relations.entries()].some(
      ([name, kind]) => name !== "schema_migrations" && kind !== "i" && kind !== "I",
    )) {
      throw new Error(`Existing schema ${schema} has objects without migration history; operator-controlled adoption is required`);
    }
    for (const id of appliedChecksums.keys()) {
      if (!migrationIds.some((migrationId) => migrationId === id)) {
        throw new Error(`Applied migration is absent from manifest: ${id}`);
      }
    }
    for (const [index, id] of migrationIds.entries()) {
      if (appliedChecksums.has(id) !== (index < history.rows.length)) {
        throw new Error(`Migration history is not an ordered prefix of the manifest: ${id}`);
      }
    }
    for (const migration of migrations) {
      const appliedChecksum = appliedChecksums.get(migration.id);
      if (appliedChecksum !== undefined && appliedChecksum !== migration.checksum) {
        throw new Error(`Migration checksum mismatch for ${migration.id}: applied=${appliedChecksum}, current=${migration.checksum}`);
      }
    }
    assertSchemaMatchesHistory(await readSchemaCatalog(client, schema), history.rows.length);

    const applied: string[] = [];
    const skipped: string[] = [];
    for (const migration of migrations) {
      if (appliedChecksums.has(migration.id)) {
        skipped.push(migration.id);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        assertSchemaMatchesHistory(await readSchemaCatalog(client, schema), appliedChecksums.size + applied.length + 1);
        await client.query(
          `INSERT INTO ${historyTable} (migration_id, checksum) VALUES ($1, $2)`,
          [migration.id, migration.checksum],
        );
        await client.query("COMMIT");
        applied.push(migration.id);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return { applied, skipped };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
  }
}
