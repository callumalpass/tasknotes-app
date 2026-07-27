import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react()],
  build: {
    // Collection and cloud runtimes load after the small location gate. Keep
    // warnings focused on unexpectedly large individual chunks.
    chunkSizeWarningLimit: 620,
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
  },
  test: {
    environment: "jsdom",
    exclude: ["e2e/**", "node_modules/**"],
    globals: true,
    maxWorkers: 4,
    setupFiles: "./src/test/setup.ts",
    restoreMocks: true,
  },
});
