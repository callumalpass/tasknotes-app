import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";
import { access } from "node:fs/promises";
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
  cp,
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
const root = ownedPath(resolve(evidenceRoot, "returning-ux-d780-20261010"));
const profile = ownedPath(resolve(root, "profile-returning"));
const originalProfile = ownedPath(
  resolve(evidenceRoot, "first-run-20261010", "profile-a"),
);
const mode = process.argv[2] ?? "fresh";
if (!["fresh", "continue-co1842"].includes(mode))
  throw Error("Unknown returning UX authority");
const continuing = mode === "continue-co1842";
const profileExists = await access(profile).then(
  () => true,
  () => false,
);
if (continuing !== profileExists)
  throw Error(
    "Returning profile allocation differs from exact scope; no automatic replay",
  );
const reportPath = resolve(
  root,
  continuing
    ? `returning-ux-continuation-${new Date().toISOString().replaceAll(":", "-")}.json`
    : "returning-ux-report.json",
);
const proof = await verifyInterimServed();
const report = {
  environment: "lab",
  authority: continuing
    ? "co1842-same-pending-signin-continuation-no-reselect"
    : "co1829-returning-user-existing-fixture-one-task-softdelete",
  proof,
  result: "blocked",
  stage: "passive-existing-own-fixture-binding",
  timings: {},
  steps: [],
  appClicks: 0,
  portalClicks: 0,
  pageErrors: 0,
  consoleErrors: 0,
  nonLabRequestsBlocked: 0,
  setupClicks: 0,
  newCollections: 0,
};
const credentials = await disposableCredentials();
let context, page, journey, timer, collectionId;
let activeProfile = originalProfile;
async function guardedContext(path) {
  const ctx = await chromium.launchPersistentContext(path, {
    headless: true,
    viewport: { width: 1440, height: 1000 },
  });
  await observeOwnCollectionBinding(ctx);
  await ctx.route("**/*", async (route) => {
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
  return ctx;
}
async function snapshot(label, target = page) {
  report.steps.push({
    label,
    text: redact((await target.locator("main").allTextContents()).join("\n")),
    buttons: (await target.getByRole("button").allTextContents()).map(redact),
  });
  await saveReport(reportPath, report);
}
async function clickApp(name, marker) {
  const action = () => appClick(page, name);
  if (marker) await once(root, marker, action);
  else await action();
  report.appClicks++;
  await snapshot(name);
}
async function scenario() {
  // Private identity binding is read from the real original UI, not copied
  // sessions/stores or guessed portal entries. Close before the fresh browser.
  context = await guardedContext(originalProfile);
  await assertAccount(context, credentials.accountId);
  const binder = await context.newPage();
  collectionId = await openOwnPairedCollection(binder, interim.url);
  report.bindingBrowserCleanup = await closeOwnedBrowser(
    context,
    originalProfile,
  );
  if (report.bindingBrowserCleanup === "cleanup-blocked")
    throw Error("Binding browser did not stop; no second browser allowed");
  context = undefined;
  activeProfile = profile;
  if (continuing) context = await guardedContext(profile);
  else
    await once(root, "one-fresh-returning-profile", async () => {
      context = await guardedContext(profile);
    });
  page = await context.newPage();
  journey = new UserJourney(page, root);
  page.on("pageerror", () => report.pageErrors++);
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors++;
  });
  let signInStart = performance.now();
  let start = performance.now();
  if (continuing) {
    report.stage = "restore-same-original-signin";
    await page.goto(interim.url);
    await clickApp(
      "Resume this device's original sign-in",
      "returning-resume-pending-co1842",
    );
  } else {
    report.stage = "cold-first-entry";
    await page.goto(interim.url);
    const signIn = page.getByRole("button", {
      name: "Sign in on this device",
      exact: true,
    });
    await expect(signIn).toBeEnabled({ timeout: 45000 });
    report.timings.coldNavigationToInteractiveMs = Math.round(
      performance.now() - start,
    );
    await snapshot("cold-entry");
    report.entryScreenshot = await journey.screenshot("returning-cold-entry");
    if (
      await page
        .getByRole("checkbox", {
          name: "Request permission to create collections",
        })
        .isChecked()
    )
      throw Error("Unexpected create permission preselection");
    report.stage = "ordinary-fresh-device-signin";
    signInStart = performance.now();
    await clickApp(
      "Sign in on this device",
      "returning-native-signin-original-request",
    );
  }
  const link = page.getByRole("link", {
    name: "Select account and approve in mdbase Connect",
    exact: true,
  });
  await expect(link).toBeVisible({ timeout: 45000 });
  if (new URL(await link.getAttribute("href")).origin !== cp)
    throw Error("Approval portal origin mismatch");
  await snapshot("Connect-link-ready");
  const popup = context.waitForEvent("page");
  await link.click();
  report.appClicks++;
  const portal = await popup;
  await portal.waitForLoadState("domcontentloaded");
  if (!continuing) {
    report.stage = "ordinary-portal-login";
    await portal
      .getByLabel("Email", { exact: true })
      .waitFor({ timeout: 30000 });
    await snapshot("Connect-login", portal);
    try {
      await portal.getByLabel("Email", { exact: true }).fill(credentials.email);
      await portal
        .getByLabel("Password", { exact: true })
        .fill(credentials.password);
      await once(root, "returning-portal-login", () =>
        portal.getByRole("button", { name: "Sign in", exact: true }).click(),
      );
      report.portalClicks++;
      await expect(portal.getByLabel("Password", { exact: true })).toHaveCount(
        0,
        { timeout: 30000 },
      );
    } catch {
      throw Error("Ordinary returning portal login did not complete");
    }
    await assertAccount(context, credentials.accountId);
    report.accountMatched = true;
    report.stage = "select-account-and-original-device-approval";
    await expect(
      portal.getByRole("button", { name: "Use this account", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await snapshot("Connect-account-selection", portal);
    await once(root, "returning-select-account", () =>
      portal
        .getByRole("button", { name: "Use this account", exact: true })
        .click(),
    );
    report.portalClicks++;
    await snapshot("Connect-account-selected", portal);
  } else {
    await assertAccount(context, credentials.accountId);
    report.accountMatched = true;
    await snapshot("Connect-same-pending-selection-status", portal);
  }
  await clickApp("Check original approval");
  const confirm = page.getByRole("button", {
    name: "Confirm this account on this device",
    exact: true,
  });
  for (const delay of [1000, 14000, 50000, 55000]) {
    if (await confirm.isVisible()) break;
    await page.waitForTimeout(delay);
    await snapshot("same-selection-passive-status", portal);
    await snapshot("same-selection-passive-app-status");
  }
  await expect(confirm).toBeVisible({ timeout: 1000 });
  await clickApp(
    "Confirm this account on this device",
    "returning-confirm-account",
  );
  await clickApp(
    "Send original device approval",
    "returning-send-device-approval",
  );
  await portal
    .getByRole("button", { name: "Check device key", exact: true })
    .click();
  report.portalClicks++;
  await expect(
    portal.getByRole("button", { name: "Approve this device", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await snapshot("Connect-device-approval", portal);
  const group = portal.getByRole("group", {
    name: "Entire collections",
    exact: true,
  });
  if (
    await group
      .getByRole("checkbox")
      .evaluateAll((choices) => choices.some((choice) => choice.checked))
  )
    throw Error("Unexpected broader collection preselection");
  const target = portal
    .locator("fieldset label")
    .filter({
      has: portal
        .locator("code")
        .filter({ hasText: new RegExp(`^${collectionId}$`) }),
    })
    .getByRole("checkbox");
  await expect(target).toHaveCount(1);
  await target.check();
  report.portalClicks++;
  if (
    await portal
      .getByRole("checkbox", { name: "Create new collections", exact: true })
      .isChecked()
  )
    throw Error("Unrequested create access selected");
  const approved = portal.waitForResponse(
    (response) =>
      new URL(response.url()).origin === cp &&
      new URL(response.url()).pathname.endsWith("/approve") &&
      response.request().method() === "POST",
  );
  await once(root, "returning-approve-only-existing-fixture", () =>
    portal
      .getByRole("button", { name: "Approve this device", exact: true })
      .click(),
  );
  report.portalClicks++;
  if ((await approved).status() !== 200)
    throw Error("Returning device approval failed");
  const approvedAt = performance.now();
  report.timings[
    continuing
      ? "restoredOriginalSignInToApprovedMs"
      : "signInClickToApprovedMs"
  ] = Math.round(approvedAt - signInStart);
  report.continuousFirstSignInTimingQualified = !continuing;
  await snapshot("Connect-approved-return-status", portal);
  await portal.close();
  report.stage = "return-and-open-existing-fixture-no-setup";
  await clickApp("Check original approval");
  await clickApp("Refresh approved collections");
  const choices = page.locator("section ul li");
  if ((await choices.count()) !== 1)
    throw Error("Returning approval not exactly one existing collection");
  await snapshot("existing-collection-selection");
  start = performance.now();
  await choices.getByRole("button").click();
  report.appClicks++;
  await page
    .getByRole("heading", { name: "Today", exact: true, level: 1 })
    .or(page.getByRole("heading", { name: "Set up TaskNotes", exact: true }))
    .waitFor({ timeout: 65000 });
  report.timings.existingCollectionOpenMs = Math.round(
    performance.now() - start,
  );
  report.setupShownForExistingCollection = await page
    .getByRole("heading", { name: "Set up TaskNotes", exact: true })
    .isVisible();
  await snapshot("existing-collection-open-result");
  if (report.setupShownForExistingCollection)
    throw Error(
      "Existing configured fixture asked for setup; no setup clicked",
    );
  if ((await readOwnCollectionBinding(page)) !== collectionId)
    throw Error("Returning fixture identity mismatch");
  report.collectionMatched = true;
  report.timings.approvedToTodayReadyMs = Math.round(
    performance.now() - approvedAt,
  );
  report.todayScreenshot = await journey.screenshot(
    "returning-today-existing-fixture",
  );
  const title = "[test] e2e-returning-d780 latency task";
  report.stage = "one-synthetic-task-create";
  await page.getByLabel("New task title", { exact: true }).fill(title);
  start = performance.now();
  await once(root, "returning-one-task-create", () =>
    page.getByRole("button", { name: "Add", exact: true }).click(),
  );
  report.appClicks++;
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toBeVisible({ timeout: 45000 });
  report.timings.taskCreateToVisibleMs = Math.round(performance.now() - start);
  await page.getByRole("button", { name: title, exact: true }).click();
  report.appClicks++;
  const details = page.getByRole("region", {
    name: "Task details",
    exact: true,
  });
  await expect(details).toBeVisible({ timeout: 30000 });
  await expect(details.getByRole("status")).toHaveText("Saved", {
    timeout: 45000,
  });
  report.taskSavedStatusVisible = true;
  report.timings.taskCreateClickToSavedDetailVisibleMs = Math.round(
    performance.now() - start,
  );
  await snapshot("created-task-detail-save-status");
  report.stage = "reload-task-data-readback";
  start = performance.now();
  await page.reload();
  if ((await openOwnPairedCollection(page, interim.url)) !== collectionId)
    throw Error("Returning reload fixture mismatch");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page
    .getByRole("searchbox", { name: "Search tasks", exact: true })
    .fill(title);
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toBeVisible({ timeout: 45000 });
  report.timings.reloadToTaskDataVisibleMs = Math.round(
    performance.now() - start,
  );
  report.taskPresentAfterReload = true;
  report.reloadTaskScreenshot = await journey.screenshot(
    "returning-task-reload-visible",
  );
  report.stage = "one-task-soft-delete";
  await page.getByRole("button", { name: title, exact: true }).click();
  await page
    .getByRole("button", { name: "More task actions", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await once(root, "returning-one-task-soft-delete", () =>
    page.getByRole("button", { name: "Delete task", exact: true }).click(),
  );
  await expect(
    page.getByRole("region", { name: "Task details", exact: true }),
  ).toHaveCount(0, { timeout: 30000 });
  report.undoOffered = await page
    .getByRole("button", { name: "Undo", exact: true })
    .isVisible();
  report.alerts = (await page.getByRole("alert").allTextContents()).map(redact);
  await snapshot("one-task-soft-delete-status");
  await page.waitForTimeout(32000); // Deliberate observation of the advertised Undo window.
  if ((await openOwnPairedCollection(page, interim.url)) !== collectionId)
    throw Error("Delete readback fixture mismatch");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page
    .getByRole("searchbox", { name: "Search tasks", exact: true })
    .fill(title);
  await expect(
    page.getByText("No tasks matched.", { exact: true }),
  ).toBeVisible({ timeout: 45000 });
  report.softDeletedTaskAbsentAfterReload = true;
  report.result = "passed";
}
try {
  await Promise.race([
    scenario(),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(Error("Returning UX deadline; no retry/new fixture")),
        500000,
      );
    }),
  ]);
} catch (error) {
  report.error = redact(error.message);
  if (journey)
    report.failureScreenshot = await journey
      .screenshot("returning-ux-failure")
      .catch(() => null);
} finally {
  clearTimeout(timer);
  if (context) report.cleanup = await closeOwnedBrowser(context, activeProfile);
  await saveReport(reportPath, report);
}
console.log(
  JSON.stringify({
    result: report.result,
    stage: report.stage,
    evidence: reportPath,
    cleanup: report.cleanup,
  }),
);
