import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { UserJourney } from "./journeys.mjs";
import {
  evidenceRoot,
  expected,
  once,
  ownedPath,
  redact,
  saveReport,
  verifyServed,
} from "./support.mjs";

// No fixture globals, copied sessions, shared browser or preview-server control.
// Requires release READY and an explicit local scope acknowledgement.
const [action = "inspect", run = "", ready = ""] = process.argv.slice(2);
if (
  !["inspect", "signin"].includes(action) ||
  !/^[a-z0-9-]+$/.test(run) ||
  !ready ||
  process.env.E2E_LAB_SCOPE !== "fresh-disposable-profile"
) {
  throw Error(
    "Usage: E2E_LAB_SCOPE=fresh-disposable-profile node scripts/live-e2e/entry.mjs inspect|signin RUN RELEASE_READY_PATH",
  );
}
const root = ownedPath(resolve(evidenceRoot, run));
await verifyServed(ready); // Before browser launch, not merely after navigation.
await mkdir(root, { recursive: true, mode: 0o700 });
const started = performance.now();
const context = await chromium.launchPersistentContext(
  resolve(root, "profile-a"),
  {
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
);
const report = {
  environment: "lab",
  action,
  source: expected.source,
  timings: {},
  clicks: 0,
  pageErrors: 0,
  consoleErrors: 0,
  failedRequests: 0,
  result: "inconclusive",
};
try {
  context.on("page", (page) => {
    page.on("pageerror", () => report.pageErrors++);
    page.on("console", (message) => {
      if (message.type() === "error") report.consoleErrors++;
    });
    page.on("requestfailed", () => report.failedRequests++);
  });
  // Protect navigation from accidentally following a staging/production link.
  await context.route("**/*", async (route) => {
    if (route.request().isNavigationRequest()) {
      const origin = new URL(route.request().url()).origin;
      if (
        ![
          new URL(expected.url).origin,
          "https://connect-lab.mdbase.dev",
        ].includes(origin)
      ) {
        await route.abort();
        return;
      }
    }
    await route.continue();
  });
  const page = await context.newPage();
  await page.goto(expected.url);
  await page
    .getByRole("heading", { name: "Open TaskNotes", exact: true })
    .waitFor();
  report.timings.entryVisibleMs = Math.round(performance.now() - started);
  if (action === "signin") {
    await page
      .getByRole("checkbox", {
        name: "Request permission to create collections",
      })
      .check();
    report.clicks++;
    const signInStart = performance.now();
    await once(root, "fresh-signin", () =>
      page
        .getByRole("button", { name: "Sign in on this device", exact: true })
        .click(),
    );
    report.clicks++;
    await page
      .getByRole("link", {
        name: "Select account and approve in mdbase Connect",
      })
      .waitFor({ timeout: 45000 });
    report.timings.signInRequestMs = Math.round(
      performance.now() - signInStart,
    );
    // Do not print/persist the verification URI, which carries approval secrets.
    report.portalLinkPresent = true;
  }
  report.uiText = redact(await page.locator("main").innerText());
  report.screenshot = await new UserJourney(page, root).screenshot(action);
  report.result = "passed";
} catch (error) {
  report.result = "blocked";
  report.error = redact(error.message);
} finally {
  await context.close(); // Entire browser is owned by this invocation.
  report.cleanup = "owned-browser-stopped-profile-retained";
  await saveReport(resolve(root, `${action}-report.json`), report);
}
console.log(
  JSON.stringify({
    result: report.result,
    evidence: resolve(root, `${action}-report.json`),
    timings: report.timings,
  }),
);
if (report.result !== "passed") process.exitCode = 1;
