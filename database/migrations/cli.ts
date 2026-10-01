import { Pool } from "pg";
import { runMigrations } from "./runner";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run PostgreSQL migrations");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const client = await pool.connect();
    try {
      const result = await runMigrations(client);
      console.log(`Migrations: ${result.applied.length} applied, ${result.skipped.length} skipped`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
