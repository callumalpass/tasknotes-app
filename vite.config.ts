import { offlineShellPlugin } from "@mdbase-dev/sdk/offline-shell/build";
import react from "@vitejs/plugin-react";
import { readdirSync, readFileSync } from "node:fs";
import { lingui } from "@lingui/vite-plugin";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { buildIdentity } from "./scripts/build-identity.ts";
import { uiCatalogueImports } from "./scripts/vite-ui-catalogues.ts";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };
const build = buildIdentity(version, process.env);
const DIRECT_MODE = "self-hosted";

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

export default defineConfig(({ command, mode, isPreview }) => ({
  ...(mode === DIRECT_MODE
    ? { root: resolve(import.meta.dirname, "self-hosted") }
    : {}),
  resolve: {
    alias:
      mode === DIRECT_MODE
        ? [{ find: "@mdbase-dev/sdk", replacement: "@tasknotes/direct-sdk" }]
        : command === "serve" && mode !== "test" && !isPreview
          ? [
              {
                find: /^\.\.\/generated\/mdbase-app\.json$/,
                replacement: resolve(
                  import.meta.dirname,
                  "src/generated/mdbase-app.development.json",
                ),
              },
            ]
          : [],
  },
  define: {
    __SELF_HOSTED_UI_ORIGIN__: JSON.stringify(
      mode === DIRECT_MODE
        ? null
        : selfHostedUiOrigin(process.env.TASKNOTES_SELF_HOSTED_UI_ORIGIN),
    ),
    __APP_VERSION__: JSON.stringify(build.version),
    __APP_BUILD_REVISION__: JSON.stringify(build.revision),
  },
  base: mode === DIRECT_MODE ? "/" : (process.env.VITE_BASE_PATH ?? "/"),
  ...(mode === DIRECT_MODE ? { envDir: false as const, envPrefix: [] } : {}),
  plugins: [
    mode === DIRECT_MODE
      ? directCollectionEntry(command, isPreview)
      : androidNotificationSmokeEntry(),
    uiCatalogueImports(),
    react(),
    lingui({ macroTransform: true }),
    mode !== DIRECT_MODE &&
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
    ...(mode === DIRECT_MODE
      ? {
          outDir: resolve(import.meta.dirname, "out/self-hosted"),
          emptyOutDir: true,
          copyPublicDir: false,
          // Fonts must come from this origin under the direct entry’s CSP.
          assetsInlineLimit: 0,
        }
      : {}),
    // Collection and cloud runtimes load after the small location gate. Keep
    // warnings focused on unexpectedly large individual chunks.
    chunkSizeWarningLimit: 620,
    rollupOptions: {
      input: {
        app: resolve(
          import.meta.dirname,
          mode === DIRECT_MODE ? "self-hosted/index.html" : "index.html",
        ),
        ...(mode !== DIRECT_MODE
          ? {
              "service-worker": resolve(
                import.meta.dirname,
                "src/service-worker.ts",
              ),
            }
          : {}),
        ...e2eFixtureInputs(mode),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "service-worker"
            ? "service-worker.js"
            : mode !== DIRECT_MODE && chunk.name === "app" && build.commit
              ? `assets/index-tasknotes-${build.commit.slice(0, 12)}.js`
              : "assets/[name]-[hash].js",
      },
    },
  },
  server: {
    host: process.env.TASKNOTES_DEV_HOST ?? "127.0.0.1",
    port: Number(process.env.TASKNOTES_DEV_PORT ?? 4173),
    strictPort: true,
    // A service on another site can't set the same-site session cookie, so LAB
    // reaches it same-origin. Set VITE_TASKNOTES_CALENDAR_ORIGIN to this path.
    proxy:
      mode !== DIRECT_MODE && process.env.TASKNOTES_CALENDAR_PROXY
        ? {
            "/calendar-service": {
              target: process.env.TASKNOTES_CALENDAR_PROXY,
              changeOrigin: true,
              headers: { origin: "http://localhost:4173" },
              rewrite: (path) => path.replace(/^\/calendar-service/, ""),
            },
          }
        : undefined,
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
    // Publisher node:test suites run separately via test:publisher (with crypto).
    exclude: [
      "**/apps/**",
      "**/.claude/**",
      "**/e2e/**",
      "**/node_modules/**",
      "**/scripts/publisher/**",
    ],
    globals: true,
    maxWorkers: 4,
    setupFiles: "./src/test/setup.ts",
    globalSetup: "./scripts/vitest-repository-guard.mjs",
    testTimeout: 10_000,
    restoreMocks: true,
  },
}));

function selfHostedUiOrigin(value?: string): string | null {
  if (!value) return null;
  const origin = new URL(value).origin;
  if (
    !origin.startsWith("https://") ||
    (value !== origin && value !== `${origin}/`)
  )
    throw new Error(
      "TASKNOTES_SELF_HOSTED_UI_ORIGIN must be a canonical HTTPS origin",
    );
  return origin;
}

function directCollectionEntry(
  command: "build" | "serve",
  isPreview: boolean | undefined,
): import("vite").Plugin {
  if (command !== "build" && !isPreview)
    throw new Error("Use pnpm build:self-hosted for direct collection access.");
  return {
    name: "tasknotes-direct-collection-entry",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: readFileSync(
          new URL("./self-hosted/_headers", import.meta.url),
        ),
      });
      this.emitFile({
        type: "asset",
        fileName: "tasknotes-mark.svg",
        source: readFileSync(
          new URL("./public/tasknotes-mark.svg", import.meta.url),
        ),
      });
    },
  };
}

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
