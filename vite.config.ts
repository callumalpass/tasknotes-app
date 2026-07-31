import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react()],
  build: {
    // Collection and cloud runtimes load after the small location gate. Keep
    // warnings focused on unexpectedly large individual chunks.
    chunkSizeWarningLimit: 620,
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, "index.html"),
        "service-worker": resolve(import.meta.dirname, "src/service-worker.ts"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "service-worker"
            ? "service-worker.js"
            : "assets/[name]-[hash].js",
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
    headers: {
      "Service-Worker-Allowed": process.env.VITE_BASE_PATH ?? "/",
    },
  },
  test: {
    environment: "jsdom",
    exclude: ["e2e/**", "node_modules/**"],
    globals: true,
    maxWorkers: 4,
    setupFiles: "./src/test/setup.ts",
    testTimeout: 10_000,
    restoreMocks: true,
  },
});
