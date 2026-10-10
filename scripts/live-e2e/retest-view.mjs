import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  evidenceRoot,
  ownedPath,
  once,
  redact,
  saveReport,
} from "./support.mjs";
import { interim, verifyInterimServed } from "./interim-support.mjs";
import { disposableCredentials } from "./credentials.mjs";
import {
  assertAccount,
  observeOwnCollectionBinding,
  openOwnPairedCollection,
  closeOwnedBrowser,
} from "./browser-flow.mjs";
import { UserJourney } from "./journeys.mjs";

if (process.env.E2E_LAB_SCOPE !== "fresh-disposable-profile")
  throw Error("Explicit LAB scope required");
const root = ownedPath(resolve(evidenceRoot, "view-d780-retest-20261010"));
const profile = ownedPath(
  resolve(evidenceRoot, "first-run-20261010", "profile-a"),
);
const proof = await verifyInterimServed();
const report = {
  finding: "E2E-005",
  environment: "lab",
  authority: "co1733-existing-fixture-newview",
  proof,
  result: "blocked",
  stage: "resume-existing-own-fixture",
  timings: {},
  nonLabRequestsBlocked: 0,
};
const name = "[test] e2e-d780-retest view";
let context, page, journey, timer;
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
  credentials.email = "";
  credentials.password = "";
  page = await context.newPage();
  journey = new UserJourney(page, root);
  const collection = await openOwnPairedCollection(page, interim.url);
  report.stage = "one-new-view-create";
  await page.getByRole("button", { name: "Manage views", exact: true }).click();
  if (
    await page
      .getByRole("button", { name: `More actions for ${name}`, exact: true })
      .count()
  )
    throw Error("New synthetic view already present; no replacement submit");
  await page.getByRole("button", { name: "Create view", exact: true }).click();
  await page.getByLabel("View name", { exact: true }).fill(name);
  const start = performance.now();
  await once(root, "d780-view-create-original-save", () =>
    page.getByRole("button", { name: "Save view", exact: true }).click(),
  );
  await expect(
    page.getByRole("button", { name: `More actions for ${name}`, exact: true }),
  ).toBeVisible({ timeout: 45000 });
  report.timings.createViewMs = Math.round(performance.now() - start);
  report.createVisible = true;
  report.alerts = (await page.getByRole("alert").allTextContents()).map(redact);
  if (report.alerts.length)
    throw Error(`View-create alert: ${report.alerts.join("; ")}`);
  report.createdScreenshot = await journey.screenshot("d780-view-created");
  report.stage = "reload-created-view-readback";
  const reopened = await openOwnPairedCollection(page, interim.url);
  report.collectionMatchedAfterReload = reopened === collection;
  if (!report.collectionMatchedAfterReload)
    throw Error("Existing fixture changed across reload");
  await page.getByRole("button", { name: "Manage views", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `More actions for ${name}`, exact: true }),
  ).toBeVisible({ timeout: 45000 });
  report.createdViewPresentAfterReload = true;
  report.reloadScreenshot = await journey.screenshot(
    "d780-view-reload-readback",
  );
  report.result = "passed";
}
try {
  await Promise.race([
    scenario(),
    new Promise((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            Error(
              "View retest deadline; retain fixture and markers, no automatic retry",
            ),
          ),
        180000,
      );
    }),
  ]);
} catch (error) {
  report.error = redact(error.message);
  if (journey)
    report.failureScreenshot = await journey
      .screenshot("d780-view-retest-failure")
      .catch(() => null);
} finally {
  clearTimeout(timer);
  if (context) report.cleanup = await closeOwnedBrowser(context, profile);
  await saveReport(resolve(root, "view-retest-report.json"), report);
}
console.log(
  JSON.stringify({
    result: report.result,
    stage: report.stage,
    evidence: resolve(root, "view-retest-report.json"),
    cleanup: report.cleanup,
  }),
);
