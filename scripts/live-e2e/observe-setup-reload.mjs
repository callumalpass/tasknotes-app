import { chromium } from "@playwright/test";
import { resolve } from "node:path";
import { access } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { evidenceRoot, ownedPath, redact, saveReport } from "./support.mjs";
import { interim, verifyInterimServed } from "./interim-support.mjs";
import { closeOwnedBrowser, appClick, assertAccount } from "./browser-flow.mjs";
import { disposableCredentials } from "./credentials.mjs";
import { UserJourney } from "./journeys.mjs";

if (process.env.E2E_LAB_SCOPE !== "fresh-disposable-profile")
  throw Error("Explicit LAB scope required");
const [mode = "entry-only"] = process.argv.slice(2);
if (!["entry-only", "restore-collection"].includes(mode))
  throw Error("Unknown observation scope");
const file =
  mode === "restore-collection"
    ? `setup-collection-observation-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
    : "setup-reload-observation.json";
const root = ownedPath(resolve(evidenceRoot, "scratchpad-d780-fresh-20261010"));
const profile = ownedPath(resolve(root, "profile-a"));
await access(profile);
const proof = await verifyInterimServed();
const report = {
  environment: "lab",
  authority:
    mode === "restore-collection"
      ? "co1800-restore-observe-only"
      : "co1751-observe-only",
  proof,
  result: "inconclusive",
  samples: [],
  submissions: 0,
  clicks: 0,
  pageErrors: 0,
  consoleErrors: 0,
  nativeLogRequests: 0,
  nonLabRequestsBlocked: 0,
};
let context, page, journey, timer;
async function scenario() {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 1440, height: 1000 },
  });
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const lab =
      url.origin === new URL(interim.url).origin ||
      url.origin === interim.logOrigin ||
      (url.protocol === "https:" &&
        /^[a-z0-9-]+-lab\.mdbase\.dev$/.test(url.hostname));
    if (
      !lab &&
      (request.isNavigationRequest() ||
        ["fetch", "xhr"].includes(request.resourceType()))
    ) {
      report.nonLabRequestsBlocked++;
      await route.abort();
      return;
    }
    if (url.origin === interim.logOrigin) report.nativeLogRequests++;
    await route.continue();
  });
  page = await context.newPage();
  journey = new UserJourney(page, root);
  page.on("pageerror", () => report.pageErrors++);
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors++;
  });
  await page.goto(interim.url);
  await page.reload();
  if (mode === "restore-collection") {
    const credentials = await disposableCredentials();
    await assertAccount(context, credentials.accountId);
    report.accountMatched = true;
    await appClick(page, "Resume this device's original sign-in");
    await appClick(page, "Confirm this account on this device");
    await appClick(page, "Refresh approved collections");
    const choices = page.locator("section ul li");
    if ((await choices.count()) !== 1)
      throw Error("Retained device scope not exactly one collection; stop");
    await choices.getByRole("button").click();
    report.soleScopedCollectionOpened = true;
    report.clicks = 4;
  }
  const start = performance.now();
  for (const deadline of [1000, 15000, 65000]) {
    await delay(Math.max(0, deadline - (performance.now() - start)));
    const sample = {
      elapsedMs: Math.round(performance.now() - start),
      text: redact(await page.locator("main").last().innerText()),
      alerts: (await page.getByRole("alert").allTextContents()).map(redact),
      setupHeading: await page
        .getByRole("heading", { name: "Set up TaskNotes", exact: true })
        .isVisible(),
      todayHeading: await page
        .getByRole("heading", { name: "Today", exact: true, level: 1 })
        .isVisible(),
      resumeOriginalSignIn: await page
        .getByRole("button", {
          name: "Resume this device's original sign-in",
          exact: true,
        })
        .isVisible(),
      waitingForSetupConfirmation: (
        await page.locator("main").last().innerText()
      ).includes("Waiting for setup confirmation"),
    };
    sample.screenshot = await journey.screenshot(
      `setup-observe-${mode === "restore-collection" ? "collection-complete" : "reload"}-${deadline}`,
    );
    report.samples.push(sample);
    await saveReport(resolve(root, file), report);
  }
  report.result = "observed";
}
try {
  await Promise.race([
    scenario(),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(Error("Observe-only reload deadline")),
        100000,
      );
    }),
  ]);
} catch (error) {
  report.error = redact(error.message);
} finally {
  clearTimeout(timer);
  if (context) report.cleanup = await closeOwnedBrowser(context, profile);
  await saveReport(resolve(root, file), report);
}
console.log(
  JSON.stringify({
    result: report.result,
    evidence: resolve(root, file),
    cleanup: report.cleanup,
  }),
);
