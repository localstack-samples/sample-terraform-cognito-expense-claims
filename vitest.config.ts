import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // The tests share state (claim id, tokens) and must run in order.
    sequence: { concurrent: false },
    fileParallelism: false,
  },
});
