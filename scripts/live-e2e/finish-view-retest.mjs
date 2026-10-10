import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
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
const prior = JSON.parse(
  await readFile(resolve(root, "view-retest-report.json"), "utf8"),
);
if (prior.result !== "passed" || !prior.createdViewPresentAfterReload)
  throw Error("Original created-view witness missing");
const proof = await verifyInterimServed();
const report = {
  finding: "E2E-005",
  environment: "lab",
  authority: "co1800-edit-softdelete-same-view",
  proof,
  result: "blocked",
  stage: "resume-existing-own-fixture",
  timings: {},
  softDeleteOnly: true,
};
const name = "[test] e2e-d780-retest view",
  edited = `${name} edited`;
let context, page, journey, timer;
const actions = (title) =>
  page.getByRole("button", { name: `More actions for ${title}`, exact: true });
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
      report.nonLabRequestsBlocked = true;
      await route.abort();
      return;
    }
    await route.continue();
  });
  const credentials = await disposableCredentials();
  await assertAccount(context, credentials.accountId);
  page = await context.newPage();
  journey = new UserJourney(page, root);
  const collection = await openOwnPairedCollection(page, interim.url);
  await page.getByRole("button", { name: "Manage views", exact: true }).click();
  await expect(actions(name)).toHaveCount(1);
  await actions(name).click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await page.getByLabel("View name", { exact: true }).fill(edited);
  report.stage = "same-view-edit-save";
  let start = performance.now();
  await once(root, "d780-same-view-edit-original-save", () =>
    page.getByRole("button", { name: "Save view", exact: true }).click(),
  );
  await expect(actions(edited)).toBeVisible({ timeout: 45000 });
  report.timings.editMs = Math.round(performance.now() - start);
  report.editVisible = true;
  await reopenAndManage(collection);
  await expect(actions(edited)).toBeVisible({ timeout: 45000 });
  report.editedViewPresentAfterReload = true;
  report.editReloadScreenshot = await journey.screenshot(
    "d780-view-edited-reload",
  );
  report.stage = "same-view-soft-delete";
  await actions(edited).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Your tasks won’t be deleted.");
  start = performance.now();
  await once(root, "d780-same-view-softdelete-confirm", () =>
    dialog.getByRole("button", { name: "Delete view", exact: true }).click(),
  );
  await expect(actions(edited)).toHaveCount(0, { timeout: 45000 });
  await expect(dialog).toHaveCount(0, { timeout: 45000 });
  report.timings.softDeleteMs = Math.round(performance.now() - start);
  report.stage = "soft-delete-reload-readback";
  await reopenAndManage(collection);
  await expect(actions(edited)).toHaveCount(0);
  await expect(actions(name)).toHaveCount(0);
  report.deletedViewAbsentAfterReload = true;
  report.alerts = (await page.getByRole("alert").allTextContents()).map(redact);
  if (report.alerts.length)
    throw Error(`View-retetest alert: ${report.alerts.join("; ")}`);
  report.deleteReloadScreenshot = await journey.screenshot(
    "d780-view-softdeleted-reload",
  );
  report.result = "passed";
}
async function reopenAndManage(collection) {
  if ((await openOwnPairedCollection(page, interim.url)) !== collection)
    throw Error("Existing fixture changed across reload");
  await page.getByRole("button", { name: "Manage views", exact: true }).click();
}
try {
  await Promise.race([
    scenario(),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(Error("View-finish deadline; no retry")),
        200000,
      );
    }),
  ]);
} catch (error) {
  report.error = redact(error.message);
  if (journey)
    report.failureScreenshot = await journey
      .screenshot("d780-view-finish-failure")
      .catch(() => null);
} finally {
  clearTimeout(timer);
  if (context) report.cleanup = await closeOwnedBrowser(context, profile);
  await saveReport(
    resolve(root, "view-edit-delete-retest-report.json"),
    report,
  );
}
console.log(
  JSON.stringify({
    result: report.result,
    stage: report.stage,
    evidence: resolve(root, "view-edit-delete-retest-report.json"),
    cleanup: report.cleanup,
  }),
);
