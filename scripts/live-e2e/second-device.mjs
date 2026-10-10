import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { disposableCredentials } from "./credentials.mjs";
import {
  evidenceRoot,
  expected,
  ownedPath,
  redact,
  saveReport,
  verifyServed,
} from "./support.mjs";
import { UserJourney } from "./journeys.mjs";
import {
  approveSameCollection,
  ordinaryLogin,
  observeOwnCollectionBinding,
  openOwnPairedCollection,
} from "./browser-flow.mjs";

const [run, ready] = process.argv.slice(2);
if (
  !/^[a-z0-9-]+$/.test(run ?? "") ||
  !ready ||
  process.env.E2E_LAB_SCOPE !== "fresh-disposable-profile"
)
  throw Error("Explicit disposable LAB scope required");
await verifyServed(ready);
const root = ownedPath(resolve(evidenceRoot, run));
const secondRoot = ownedPath(resolve(root, "device-b"));
const credentials = await disposableCredentials();
const report = {
  environment: "lab",
  source: expected.source,
  result: "blocked",
  stage: "own-fixture-binding",
  timings: {},
  accountMatched: false,
  collectionMatched: false,
};
let context, page, journey;
try {
  context = await chromium.launchPersistentContext(resolve(root, "profile-a"), {
    headless: true,
  });
  await ordinaryLogin(context, credentials, root, "primary-login-for-binding");
  await observeOwnCollectionBinding(context);
  page = await context.newPage();
  const collectionId = await openOwnPairedCollection(page, expected.url);
  const title = `[test] e2e-${run} offline task edited offline`;
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toBeVisible({ timeout: 30000 });
  report.primaryOfflineEditPersisted = true;
  await context.close();
  context = null;
  context = await chromium.launchPersistentContext(
    resolve(secondRoot, "profile-b"),
    { headless: true, viewport: { width: 1440, height: 1000 } },
  );
  await observeOwnCollectionBinding(context);
  report.stage = "second-device-ordinary-login";
  const loginStart = performance.now();
  await ordinaryLogin(
    context,
    credentials,
    secondRoot,
    "second-device-portal-login",
  );
  report.timings.loginMs = Math.round(performance.now() - loginStart);
  report.accountMatched = true;
  page = await context.newPage();
  journey = new UserJourney(page, secondRoot);
  await page.goto(expected.url);
  report.stage = "ordinary-same-collection-device-approval";
  const approveStart = performance.now();
  await approveSameCollection(context, page, secondRoot, collectionId);
  report.timings.approvalToWorkspaceMs = Math.round(
    performance.now() - approveStart,
  );
  report.collectionMatched = true;
  report.stage = "second-device-sees-original-edit";
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toBeVisible({ timeout: 30000 });
  report.sameTaskVisible = true;
  report.uiText = redact(await page.locator("body").innerText());
  report.screenshot = await journey.screenshot("same-collection-second-device");
  report.result = "passed";
} catch (error) {
  report.error = redact(error.message);
  if (page)
    report.uiText = redact(
      await page
        .locator("body")
        .innerText()
        .catch(() => "Unavailable"),
    );
  if (journey)
    report.screenshot = await journey
      .screenshot("second-device-failure")
      .catch(() => null);
} finally {
  await context?.close();
  credentials.email = "";
  credentials.password = "";
  report.cleanup = "all-owned-browsers-stopped-profiles-retained";
  await saveReport(resolve(secondRoot, "second-device-report.json"), report);
}
console.log(
  JSON.stringify({
    result: report.result,
    stage: report.stage,
    evidence: resolve(secondRoot, "second-device-report.json"),
    timings: report.timings,
  }),
);
