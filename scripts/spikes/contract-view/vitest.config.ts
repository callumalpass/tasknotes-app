import { defineConfig } from "vitest/config";

// Spike only: `pnpm exec vitest run --config scripts/spikes/contract-view/vitest.config.ts`.
// The default `pnpm test` include (`*.test.ts`) never picks up `*.spike.ts`.
export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    include: ["scripts/spikes/contract-view/*.spike.ts"],
    fileParallelism: false,
    disableConsoleIntercept: true,
    testTimeout: 1_800_000,
    hookTimeout: 600_000,
  },
});
