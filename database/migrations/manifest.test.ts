import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { migrationIds, validateMigrationManifest } from "./manifest";

describe("migration manifest", () => {
  it("keeps all six existing migrations as the ordered prefix", () => {
    expect(migrationIds.slice(0, 6)).toEqual([
      "001_create_memories.sql",
      "002_create_agent_tasks.sql",
      "002_create_tasks.sql",
      "003_create_task_event_log.sql",
      "004_create_memory_event_queue.sql",
      "005_add_memory_project_scope.sql",
    ]);
  });

  it("rejects duplicate full-filename migration IDs", () => {
    expect(() => validateMigrationManifest(
      ["001_first.sql", "001_first.sql"],
      ["001_first.sql"],
    )).toThrow(/duplicate migration ID: 001_first\.sql/i);
  });

  it("rejects a manifest entry whose SQL file is missing", () => {
    expect(() => validateMigrationManifest(
      ["001_first.sql", "002_missing.sql"],
      ["001_first.sql"],
    )).toThrow(/missing migration SQL file: 002_missing\.sql/i);
  });

  it("rejects a migration SQL file omitted from the manifest", () => {
    expect(() => validateMigrationManifest(
      ["001_first.sql"],
      ["001_first.sql", "002_new.sql"],
    )).toThrow(/untracked migration SQL: 002_new\.sql/i);
  });

  it("accepts the two historical 002 files as distinct full IDs", () => {
    expect(() => validateMigrationManifest(
      ["002_create_agent_tasks.sql", "002_create_tasks.sql"],
      ["002_create_tasks.sql", "002_create_agent_tasks.sql"],
    )).not.toThrow();
  });

  it("matches every SQL migration file in the actual directory", async () => {
    const sqlFiles = (await readdir(new URL(".", import.meta.url)))
      .filter((file) => file.endsWith(".sql"));

    expect(() => validateMigrationManifest(migrationIds, sqlFiles)).not.toThrow();
  });
});
