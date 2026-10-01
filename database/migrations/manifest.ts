// Full filenames are immutable migration IDs. Array order is the execution order;
// append new migrations without renaming or reordering existing entries.
export const migrationIds = [
  "001_create_memories.sql",
  "002_create_agent_tasks.sql",
  "002_create_tasks.sql",
  "003_create_task_event_log.sql",
  "004_create_memory_event_queue.sql",
  "005_add_memory_project_scope.sql",
] as const;

export function validateMigrationManifest(
  ids: readonly string[],
  availableSqlFiles: readonly string[],
): void {
  const seen = new Set<string>();
  const available = new Set(availableSqlFiles);
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`Duplicate migration ID: ${id}`);
    seen.add(id);
    if (!available.has(id)) throw new Error(`Missing migration SQL file: ${id}`);
  }
  for (const file of availableSqlFiles) {
    if (!seen.has(file)) throw new Error(`Untracked migration SQL: ${file}`);
  }
}
