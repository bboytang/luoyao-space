import { defineConfig } from "vitest";

export default defineConfig({
  test: {
    include: ["services/**/*.test.ts"],
  },
});
