import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "services/**/*.test.ts", "runtimes/**/*.test.ts", "database/**/*.test.ts", "apps/web/**/*.test.ts"],
    // Database integration files share a database-wide extension; serialize files when it is enabled.
    fileParallelism: !process.env.DATABASE_URL,
  },
});
