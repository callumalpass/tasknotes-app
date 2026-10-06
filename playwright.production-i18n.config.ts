import { defineConfig } from "@playwright/test";
import localConfig from "./playwright.config";

// Explicit acceptance for an already built NORMAL production artifact, not dev/e2e mode.
export default defineConfig({
  ...localConfig,
  testMatch: "**/i18n-production.acceptance.ts",
  webServer: {
    command:
      process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ??
      "pnpm preview --host 127.0.0.1 --port 18574",
    url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:18574",
    reuseExistingServer: false,
  },
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:18574" },
});
