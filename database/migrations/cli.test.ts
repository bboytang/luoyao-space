import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("database migration command", () => {
  it("fails clearly without DATABASE_URL", () => {
    const result = spawnSync("pnpm", ["db:migrate"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: "" },
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL is required to run PostgreSQL migrations");
  });
});
