/* global fetch, setTimeout, URL, document, innerWidth, console, process */
// Fresh local browser only. No LAB, Connect, personal profiles or production.
import { spawn } from "node:child_process";
import { chromium, expect } from "@playwright/test";
const port = 4319;
const origin = `http://127.0.0.1:${port}`;
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
    if (server.exitCode !== null) throw new Error("owned UI server exited");
    try {
      ready = (await fetch(`${origin}/e2e/private-account.fixture.html`)).ok;
    } catch {
      /* starting */
    }
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw new Error("owned UI server did not start");
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
    await page.goto(`${origin}/e2e/private-account.fixture.html`);
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.fontSize = "200%";
    }, theme);
    const setup = page.getByRole("button", { name: "Set up recovery" });
    await expect(setup).toBeDisabled();
    await page
      .getByLabel("New recovery password", { exact: true })
      .fill("correct horse battery staple");
    await page
      .getByLabel("Confirm new recovery password")
      .fill("correct horse battery staple");
    await expect(setup).toBeEnabled();
    await setup.click();
    await expect(page.getByLabel("Recovery key (shown once)")).toHaveValue(
      "MDB1-PUBLIC-TEST-FIXTURE-ONLY",
    );
    const dimensions = await page.evaluate(() => ({
      viewport: innerWidth,
      scroll: document.documentElement.scrollWidth,
      inputHeight: document.querySelector("textarea").getBoundingClientRect()
        .height,
    }));
    if (
      dimensions.scroll > dimensions.viewport + 1 ||
      dimensions.inputHeight < 44
    )
      throw new Error("private-account UI reflow/target regression");
    await page.getByRole("button", { name: "I saved my recovery key" }).click();
    await expect(page.getByLabel("Recovery key (shown once)")).toHaveCount(0);
    await page.getByRole("button", { name: "Review strict mode" }).click();
    const strict = page.getByRole("button", {
      name: "Enable strict mode",
      exact: true,
    });
    await expect(strict).toBeDisabled();
    await page.getByRole("checkbox").check();
    await strict.click();
    await expect(
      page.getByText(
        /The recovery key stays on this device until mdbase confirms completion/,
      ),
    ).toBeVisible();
    results.push({
      theme,
      ...dimensions,
      setup: "pass",
      strictConsent: "pass",
      recoveryDismiss: "pass",
    });
    await context.close();
  }
  console.log(
    JSON.stringify({
      browser: browser.version(),
      fixture: "mock authenticated ports",
      results,
    }),
  );
} finally {
  await browser?.close();
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    /* already closed */
  }
}
