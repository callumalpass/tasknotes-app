import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  use: { baseURL: "http://127.0.0.1:4317", trace: "retain-on-failure" },
  webServer: {
    command: "pnpm run preview --port 4317 --strictPort",
    url: "http://127.0.0.1:4317",
    reuseExistingServer: false,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
});
