import { offlineShellPlugin } from "@mdbase-dev/sdk/offline-shell/build";
import react from "@vitejs/plugin-react";
import { readdirSync, readFileSync } from "node:fs";
import { lingui } from "@lingui/vite-plugin";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { uiCatalogueImports } from "./scripts/vite-ui-catalogues.ts";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

/** Browser-test fixture pages, built only in e2e mode so the e2e suite can
 * run against a built preview (pull-request and Pages checks), not just the
 * dev server. Production builds never include them. */
function e2eFixtureInputs(mode: string): Record<string, string> {
  if (mode !== "e2e") return {};
  const directory = resolve(import.meta.dirname, "e2e");
  return Object.fromEntries(
    readdirSync(directory)
      .filter((name) => name.endsWith(".fixture.html"))
      .map((name) => [
        `e2e/${name.replace(/\.html$/, "")}`,
        resolve(directory, name),
      ]),
  );
}

export default defineConfig(({ mode }) => ({
  define: { __APP_VERSION__: JSON.stringify(version) },
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [
    androidNotificationSmokeEntry(),
    uiCatalogueImports(),
    react(),
    lingui({ macroTransform: true }),
    offlineShellPlugin({ workerFile: "service-worker.js", register: false }),
  ],
  worker: { format: "es" },
  // The calendar loads lazily; pre-bundle it so dev servers don't reload
  // the page when it is first opened.
  optimizeDeps: {
    // Let Vite analyze the UI's normalized lazy imports at their real location.
    exclude: ["@mdbase-dev/ui"],
    include: ["@tasknotes/calendar", "@tasknotes/calendar/react"],
  },
  build: {
    // Collection and cloud runtimes load after the small location gate. Keep
    // warnings focused on unexpectedly large individual chunks.
    chunkSizeWarningLimit: 620,
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, "index.html"),
        "service-worker": resolve(import.meta.dirname, "src/service-worker.ts"),
        ...e2eFixtureInputs(mode),
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
    host: process.env.TASKNOTES_DEV_HOST ?? "127.0.0.1",
    port: Number(process.env.TASKNOTES_DEV_PORT ?? 4173),
    strictPort: true,
    https:
      process.env.TASKNOTES_HTTPS_KEY && process.env.TASKNOTES_HTTPS_CERT
        ? {
            key: readFileSync(process.env.TASKNOTES_HTTPS_KEY),
            cert: readFileSync(process.env.TASKNOTES_HTTPS_CERT),
          }
        : undefined,
    headers: {
      "Service-Worker-Allowed": process.env.VITE_BASE_PATH ?? "/",
    },
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html"],
      thresholds: {
        statements: 68,
        branches: 60,
        functions: 66,
        lines: 71,
      },
    },
    environment: "jsdom",
    exclude: ["e2e/**", "node_modules/**"],
    globals: true,
    maxWorkers: 4,
    setupFiles: "./src/test/setup.ts",
    testTimeout: 10_000,
    restoreMocks: true,
  },
}));

function androidNotificationSmokeEntry() {
  return {
    name: "tasknotes-android-notification-smoke-entry",
    transformIndexHtml: {
      order: "pre" as const,
      handler(html: string): string {
        return process.env.VITE_TASKNOTES_ANDROID_NOTIFICATION_TEST === "1"
          ? html.replace(
              "/src/main.tsx",
              "/src/native/android-notification-smoke-main.tsx",
            )
          : html;
      },
    },
  };
}
