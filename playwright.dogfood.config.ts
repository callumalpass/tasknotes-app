import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/dogfood",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL:
      process.env.MDBASE_CONNECT_DOGFOOD_APP_URL ?? "https://localhost:5199",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ignoreHTTPSErrors: true,
    launchOptions: {
      args: ["--host-resolver-rules=MAP host.docker.internal 127.0.0.1"],
    },
    ...devices["Desktop Chrome"],
  },
});
