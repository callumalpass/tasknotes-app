import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";
import { access } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import {
  evidenceRoot,
  ownedPath,
  once,
  portableScratchpadId,
  redact,
  saveReport,
} from "./support.mjs";
import { interim, verifyInterimServed } from "./interim-support.mjs";
import { disposableCredentials } from "./credentials.mjs";
import {
  appClick,
  assertAccount,
  observeOwnCollectionBinding,
  readOwnCollectionBinding,
  openOwnPairedCollection,
  closeOwnedBrowser,
} from "./browser-flow.mjs";
import { UserJourney } from "./journeys.mjs";

if (process.env.E2E_LAB_SCOPE !== "fresh-disposable-profile")
  throw Error("Explicit LAB scope required");
const root = ownedPath(resolve(evidenceRoot, "scratchpad-d780-fresh-20261010"));
const profile = ownedPath(resolve(root, "profile-a"));
await access(profile);
const proof = await verifyInterimServed();
const file = `setup-original-resume-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
const report = {
  environment: "lab",
  authority: "co1813-one-original-setup-resume",
  proof,
  result: "blocked",
  stage: "restore-same-original-device-collection",
  samples: [],
  timings: {},
  setupResumeClicks: 0,
  scratchpadOpenClicks: 0,
  pageErrors: 0,
  consoleErrors: 0,
  nonLabRequestsBlocked: 0,
};
let context, page, journey, timer;
async function record() {
  await saveReport(resolve(root, file), report);
}
async function noteIdentity() {
  const current = page.locator(".scratchpad-current-document");
  await expect(current).toHaveCount(1, { timeout: 45000 });
  await expect(
    current.getByRole("button", { name: "Write", exact: true }),
  ).toBeVisible({ timeout: 45000 });
  const inputs = current.locator("[data-scratch-input]");
  await expect(inputs.first()).toBeVisible({ timeout: 45000 });
  const key = portableScratchpadId(
    await inputs.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-scratch-input")),
    ),
  );
  const alerts = (await page.getByRole("alert").allTextContents()).map(redact);
  if (alerts.length) throw Error(`Scratchpad alert: ${alerts.join("; ")}`);
  return key;
}
async function scenario() {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 1440, height: 1000 },
  });
  await observeOwnCollectionBinding(context);
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
    await route.continue();
  });
  const credentials = await disposableCredentials();
  await assertAccount(context, credentials.accountId);
  report.accountMatched = true;
  page = await context.newPage();
  journey = new UserJourney(page, root);
  page.on("pageerror", () => report.pageErrors++);
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors++;
  });
  await page.goto(interim.url);
  await appClick(page, "Resume this device's original sign-in");
  await appClick(page, "Confirm this account on this device");
  await appClick(page, "Refresh approved collections");
  const choices = page.locator("section ul li");
  if ((await choices.count()) !== 1)
    throw Error("Retained device scope not exactly one collection");
  await choices.getByRole("button").click();
  const resume = page.getByRole("button", {
    name: "Resume original setup",
    exact: true,
  });
  await expect(resume).toBeVisible({ timeout: 65000 });
  const collection = await readOwnCollectionBinding(page);
  report.soleScopedCollectionOpened = true;
  report.stage = "one-original-setup-resume";
  await once(root, "one-original-setup-resume-co1813", () => resume.click());
  report.setupResumeClicks = 1;
  const start = performance.now();
  for (const deadline of [1000, 15000, 65000, 120000]) {
    await delay(Math.max(0, deadline - (performance.now() - start)));
    const sample = {
      elapsedMs: Math.round(performance.now() - start),
      text: redact(await page.locator("main").last().innerText()),
      alerts: (await page.getByRole("alert").allTextContents()).map(redact),
      todayVisible: await page
        .getByRole("heading", { name: "Today", exact: true, level: 1 })
        .isVisible(),
    };
    sample.screenshot = await journey.screenshot(
      `setup-original-resume-${deadline}`,
    );
    report.samples.push(sample);
    await record();
  }
  if (!report.samples.at(-1).todayVisible) {
    report.stage = "original-setup-not-ready-after-120s";
    return;
  }
  report.setupReady = true;
  report.stage = "one-first-scratchpad-open";
  const noteStart = performance.now();
  await once(root, "one-first-scratchpad-open", () =>
    page.getByRole("button", { name: "Scratchpad", exact: true }).click(),
  );
  report.scratchpadOpenClicks++;
  const originalNote = await noteIdentity();
  report.firstOpenEditorVisible = true;
  report.timings.firstOpenMs = Math.round(performance.now() - noteStart);
  report.firstOpenScreenshot = await journey.screenshot(
    "scratchpad-first-open-after-original-setup-recovery",
  );
  await record();
  report.stage = "reload-second-open-identity-check";
  await page.reload();
  const reopenedCollection = await openOwnPairedCollection(page, interim.url);
  report.collectionMatchedAfterReload = reopenedCollection === collection;
  if (!report.collectionMatchedAfterReload)
    throw Error("Retained fixture mismatch after reload");
  await once(root, "scratchpad-second-open-identity-check", () =>
    page.getByRole("button", { name: "Scratchpad", exact: true }).click(),
  );
  report.scratchpadOpenClicks++;
  const reopenedNote = await noteIdentity();
  report.renderedPortableIdentityMatchesAfterReload =
    originalNote === reopenedNote;
  report.secondOpenEditorVisible = true;
  report.secondOpenScreenshot = await journey.screenshot(
    "scratchpad-second-open-after-original-setup-recovery",
  );
  report.result = report.renderedPortableIdentityMatchesAfterReload
    ? "passed"
    : "failed";
}
try {
  await Promise.race([
    scenario(),
    new Promise((_, reject) => {
      timer = setTimeout(
        () =>
          reject(Error("Original setup resume/Scratchpad deadline; no retry")),
        360000,
      );
    }),
  ]);
} catch (error) {
  report.error = redact(error.message);
  if (journey)
    report.failureScreenshot = await journey
      .screenshot("original-setup-resume-scratchpad-failure")
      .catch(() => null);
} finally {
  clearTimeout(timer);
  if (context) report.cleanup = await closeOwnedBrowser(context, profile);
  await record();
}
console.log(
  JSON.stringify({
    result: report.result,
    stage: report.stage,
    evidence: resolve(root, file),
    cleanup: report.cleanup,
  }),
);
