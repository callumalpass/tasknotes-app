import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";
import { access } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { disposableCredentials } from "./credentials.mjs";
import {
  evidenceRoot,
  once,
  ownedPath,
  portableScratchpadId,
  redact,
  saveReport,
} from "./support.mjs";
import { interim, verifyInterimServed } from "./interim-support.mjs";
import {
  cp,
  appClick,
  ordinaryLogin,
  observeOwnCollectionBinding,
  readOwnCollectionBinding,
  openOwnPairedCollection,
  closeOwnedBrowser,
} from "./browser-flow.mjs";
import { UserJourney } from "./journeys.mjs";

const [run] = process.argv.slice(2);
if (
  run !== "scratchpad-d780-fresh-20261010" ||
  process.env.E2E_LAB_SCOPE !== "fresh-disposable-profile"
)
  throw Error("Exact co1733 new fixture scope required");
const root = ownedPath(resolve(evidenceRoot, run)),
  profile = ownedPath(resolve(root, "profile-a"));
const proof = await verifyInterimServed();
if (
  await access(profile).then(
    () => true,
    () => false,
  )
)
  throw Error(
    "Fresh fixture profile already exists; inspect state and obtain explicit continuation, do not replay",
  );
const credentials = await disposableCredentials();
const report = {
  finding: "E2E-006",
  environment: "lab",
  proof,
  result: "blocked",
  stage: "new-owned-profile",
  accountMatched: false,
  collectionMatchedAcrossReload: false,
  timings: {},
  mutationRetries: 0,
};
let context,
  page,
  journey,
  timer,
  expired = false;
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
  return key; // Remains private; reports contain equality booleans only.
}
async function scenario() {
  await once(root, "fresh-profile-allocation", async () => {
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      viewport: { width: 1440, height: 1000 },
    });
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
  report.stage = "ordinary-primary-login";
  await ordinaryLogin(context, credentials, root, "fresh-primary-portal-login");
  report.accountMatched = true;
  page = await context.newPage();
  journey = new UserJourney(page, root);
  await page.goto(interim.url);
  await page
    .getByRole("checkbox", { name: "Request permission to create collections" })
    .check();
  report.stage = "fresh-sign-in-request";
  await once(root, "fresh-original-signin-request", () =>
    appClick(page, "Sign in on this device"),
  );
  const href = await page
    .getByRole("link", {
      name: "Select account and approve in mdbase Connect",
      exact: true,
    })
    .getAttribute("href");
  if (new URL(href).origin !== cp) throw Error("Portal origin mismatch");
  const portal = await context.newPage();
  try {
    await portal.goto(href);
    await once(root, "fresh-select-account", () =>
      portal
        .getByRole("button", { name: "Use this account", exact: true })
        .click(),
    );
    await appClick(page, "Check original approval");
    await once(root, "fresh-confirm-account", () =>
      appClick(page, "Confirm this account on this device"),
    );
    await once(root, "fresh-attest-device", () =>
      appClick(page, "Send original device approval"),
    );
    await portal
      .getByRole("button", { name: "Check device key", exact: true })
      .click();
    await expect(
      portal.getByRole("button", { name: "Approve this device", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    if (
      await portal
        .getByRole("group", { name: "Entire collections", exact: true })
        .getByRole("checkbox")
        .evaluateAll((choices) => choices.some((choice) => choice.checked))
    )
      throw Error(
        "Unexpected collection preselection; no broad approval allowed",
      );
    await portal
      .getByRole("checkbox", { name: "Create new collections", exact: true })
      .check();
    report.stage = "creation-only-device-approval";
    const approval = portal.waitForResponse(
      (response) =>
        new URL(response.url()).origin === cp &&
        new URL(response.url()).pathname.endsWith("/approve") &&
        response.request().method() === "POST",
    );
    await once(root, "fresh-approve-creation-only", () =>
      portal
        .getByRole("button", { name: "Approve this device", exact: true })
        .click(),
    );
    if ((await approval).status() !== 200)
      throw Error("Creation-only approval failed");
  } finally {
    await portal.close();
  }
  await appClick(page, "Check original approval");
  await appClick(page, "Refresh approved collections");
  if ((await page.locator("section ul li").count()) !== 0)
    throw Error("Fresh creation-only approval exposed existing collections");
  report.stage = "one-new-collection";
  await once(root, "one-disposable-collection-create", () =>
    appClick(page, "Create collection"),
  );
  await expect(page.getByRole("status")).toContainText(
    "Collection creation recorded",
    { timeout: 30000 },
  );
  await appClick(page, "Refresh approved collections");
  const choices = page.locator("section ul li");
  if ((await choices.count()) !== 1)
    throw Error("Fresh fixture must have exactly one collection");
  await choices.getByRole("button").click();
  await page
    .getByRole("heading", { name: "Set up TaskNotes", exact: true })
    .waitFor({ timeout: 65000 });
  report.stage = "one-tasknotes-setup";
  await once(root, "one-tasknotes-model-setup", () =>
    page.getByRole("button", { name: "Set up TaskNotes", exact: true }).click(),
  );
  await page
    .getByRole("heading", { name: "Today", exact: true, level: 1 })
    .waitFor({ timeout: 65000 });
  const collection = await readOwnCollectionBinding(page);
  if (expired)
    throw Error("Scenario deadline before first note open; no submission");
  report.stage = "one-first-scratchpad-open";
  const start = performance.now();
  await once(root, "one-first-scratchpad-open", () =>
    page.getByRole("button", { name: "Scratchpad", exact: true }).click(),
  );
  const original = await noteIdentity();
  report.firstOpenEditorVisible = true;
  report.timings.firstOpenMs = Math.round(performance.now() - start);
  report.firstOpenScreenshot = await journey.screenshot(
    "scratchpad-first-open-d780",
  );
  report.stage = "reload-and-second-open-identity";
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Resume this device's original sign-in",
      exact: true,
    }),
  ).toBeVisible({ timeout: 30000 });
  const reopenedCollection = await openOwnPairedCollection(page, interim.url);
  report.collectionMatchedAcrossReload = reopenedCollection === collection;
  if (!report.collectionMatchedAcrossReload)
    throw Error("Reload fixture mismatch");
  await once(root, "scratchpad-second-open-identity-check", () =>
    page.getByRole("button", { name: "Scratchpad", exact: true }).click(),
  );
  const reopened = await noteIdentity();
  report.renderedPortableIdentityMatches = original === reopened;
  report.secondOpenEditorVisible = true;
  report.secondOpenScreenshot = await journey.screenshot(
    "scratchpad-second-open-d780",
  );
  report.result = report.renderedPortableIdentityMatches ? "passed" : "failed";
}
try {
  await Promise.race([
    scenario(),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        reject(
          Error(
            "Fresh fixture scenario deadline; retain original state, no automatic retry",
          ),
        );
      }, 240000);
    }),
  ]);
} catch (error) {
  report.error = redact(error.message);
  if (page && journey)
    report.failureScreenshot = await journey
      .screenshot("scratchpad-fresh-d780-failure")
      .catch(() => null);
} finally {
  clearTimeout(timer);
  if (context) report.cleanup = await closeOwnedBrowser(context, profile);
  report.fixtureRetained = true;
  await saveReport(resolve(root, "scratchpad-retest-report.json"), report);
}
console.log(
  JSON.stringify({
    result: report.result,
    stage: report.stage,
    evidence: resolve(root, "scratchpad-retest-report.json"),
  }),
);
