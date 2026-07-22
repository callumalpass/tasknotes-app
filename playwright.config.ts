import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";
const webServerCommand =
  process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ?? "pnpm dev";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: webServerCommand,
    url: baseURL,
    reuseExistingServer: true,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
