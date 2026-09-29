import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["services/**/*.test.ts"],
  },
});
