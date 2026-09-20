import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["benchmarks/*.perf.ts"],
    fileParallelism: false,
    testTimeout: 300_000,
  },
});
