/* global fetch, setTimeout, URL, document, innerWidth, console, process */
// Fresh local browser, mock repository only. No LAB or personal profiles.
import { spawn } from "node:child_process";
import { chromium, expect } from "@playwright/test";
const port = 4320,
  origin = `http://127.0.0.1:${port}`;
const server = spawn(
  "pnpm",
  [
    "exec",
    "vite",
    "--mode",
    "e2e",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { stdio: "ignore", detached: true },
);
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null)
      throw new Error("owned fixture server exited");
    try {
      ready = (await fetch(`${origin}/e2e/held-edits.fixture.html`)).ok;
    } catch {
      /* starting */
    }
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw new Error("owned fixture server did not start");
  browser = await chromium.launch({ headless: true });
  const results = [];
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 320, height: 780 },
    });
    const page = await context.newPage();
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    await page.goto(`${origin}/e2e/held-edits.fixture.html`);
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.fontSize = "200%";
    }, theme);
    await expect(
      page.getByRole("button", { name: "Review protected edits" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Retry connection" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Compare side by side" }).click();
    await expect(page.getByLabel("Your protected version")).toHaveValue(
      "<img src=x onerror=alert(1)>\nHeld task text",
    );
    await expect(page.getByLabel("Synced version")).toHaveValue(
      "Synced task text",
    );
    await expect(page.locator("img")).toHaveCount(0);
    const dimensions = await page.evaluate(() => ({
      viewport: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    if (dimensions.scroll > dimensions.viewport + 1)
      throw new Error("protected-edit UI reflow regression");
    await page
      .getByRole("button", { name: "Take theirs", exact: true })
      .click();
    await expect(page.getByTestId("selections")).toHaveText("Selections: 0");
    await expect(
      page.getByText(/This discards your protected version/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Confirm take theirs" }).click();
    await expect(page.getByTestId("selections")).toHaveText("Selections: 1");
    await expect(
      page.getByText("Confirmed through 8, plus 1 pending, plus 0 held"),
    ).toBeVisible();
    results.push({
      theme,
      ...dimensions,
      offlineNotice: "pass",
      comparison: "pass",
      confirmation: "pass",
      pendingNotSaved: "pass",
    });
    await context.close();
  }
  console.log(
    JSON.stringify({
      browser: browser.version(),
      fixture: "mock repository",
      results,
    }),
  );
} finally {
  await browser?.close();
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    /* already stopped */
  }
}
