import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";
const webServerCommand =
  process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ?? "pnpm dev:e2e";
const testIgnore = [
  "**/dogfood/**",
  ...(process.env.MDBASE_CANDIDATE_B_SESSION_TOKEN
    ? []
    : ["**/candidate-b/**"]),
];

export default defineConfig({
  testDir: "./e2e",
  testIgnore,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: webServerCommand,
    url: baseURL,
    reuseExistingServer: false,
  },
  projects: [
    {
      name: "desktop",
      testIgnore: [...testIgnore, "**/phone.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      testMatch: "**/phone.spec.ts",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
