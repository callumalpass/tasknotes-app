import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";
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
const root = ownedPath(resolve(evidenceRoot, "scratchpad-d780-fresh-20261010"));
const profile = ownedPath(resolve(root, "profile-a"));
const proof = await verifyInterimServed();
const report = {
  finding: "E2E-006",
  environment: "lab",
  authority: "co1823-two-sequential-reopens-pure-DOM-ID",
  proof,
  result: "blocked",
  stage: "restore-same-device",
  observations: [],
  nativeIdentityClaimed: false,
  pageErrors: 0,
  consoleErrors: 0,
  nonLabRequestsBlocked: 0,
  typedOrExtraNotes: false,
};
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
  report.accountMatched = true;
  page = await context.newPage();
  journey = new UserJourney(page, root);
  page.on("pageerror", () => report.pageErrors++);
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors++;
  });
  let originalCollection, idA;
  for (const label of ["a", "b"]) {
    report.stage = `sequential-reopen-${label}`;
    await page.goto(interim.url);
    await page.reload();
    const collection = await openOwnPairedCollection(page, interim.url);
    if (originalCollection && collection !== originalCollection)
      throw Error("Retained collection changed across reopens");
    originalCollection = collection;
    await once(root, `scratchpad-identity-reopen-${label}-co1823`, () =>
      page.getByRole("button", { name: "Scratchpad", exact: true }).click(),
    );
    const current = page.locator(".scratchpad-current-document");
    await expect(current).toHaveCount(1, { timeout: 45000 });
    await expect(
      current.getByRole("button", { name: "Write", exact: true }),
    ).toBeVisible({ timeout: 45000 });
    const inputs = current.locator("[data-scratch-input]");
    await expect(inputs.first()).toBeVisible({ timeout: 45000 });
    const ids = await inputs.evaluateAll((elements) => [
      ...new Set(
        elements.map(
          (element) =>
            element.getAttribute("data-scratch-input").split(":", 1)[0],
        ),
      ),
    ]);
    if (
      ids.length !== 1 ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(ids[0])
    )
      throw Error("Actual portable document ID unavailable");
    const visibleCounts = {
      current: await current.count(),
      history: await page.locator("[data-feed-key^='scratchpad:']").count(),
    };
    const alerts = (await page.getByRole("alert").allTextContents()).map(
      redact,
    );
    if (alerts.length) throw Error(`Scratchpad alert: ${alerts.join("; ")}`);
    report.observations.push({
      label,
      editorVisible: true,
      portableIdAvailable: true,
      visibleCounts,
      alerts,
      screenshot: await journey.screenshot(
        `scratchpad-identity-reopen-${label}`,
      ),
    });
    if (label === "a") idA = ids[0];
    else report.portableDocumentIdsMatch = idA === ids[0];
    await saveReport(
      resolve(root, "scratchpad-identity-reopens-report.json"),
      report,
    );
  }
  report.collectionMatched = true;
  report.visibleNoteCountsUnchanged =
    JSON.stringify(report.observations[0].visibleCounts) ===
    JSON.stringify(report.observations[1].visibleCounts);
  report.result =
    report.portableDocumentIdsMatch && report.visibleNoteCountsUnchanged
      ? "passed"
      : "failed";
}
try {
  await Promise.race([
    scenario(),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(Error("Two-reopen identity deadline; no retry")),
        220000,
      );
    }),
  ]);
} catch (error) {
  report.error = redact(error.message);
  if (journey)
    report.failureScreenshot = await journey
      .screenshot("scratchpad-identity-reopens-failure")
      .catch(() => null);
} finally {
  clearTimeout(timer);
  if (context) report.cleanup = await closeOwnedBrowser(context, profile);
  await saveReport(
    resolve(root, "scratchpad-identity-reopens-report.json"),
    report,
  );
}
console.log(
  JSON.stringify({
    result: report.result,
    stage: report.stage,
    evidence: resolve(root, "scratchpad-identity-reopens-report.json"),
    cleanup: report.cleanup,
  }),
);
