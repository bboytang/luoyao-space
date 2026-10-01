import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["services/**/*.test.ts", "runtimes/**/*.test.ts", "database/**/*.test.ts"],
  },
});
