import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { disposableCredentials } from "./credentials.mjs";
import {
  evidenceRoot,
  expected,
  once,
  ownedPath,
  redact,
  saveReport,
  verifyServed,
} from "./support.mjs";
import { UserJourney } from "./journeys.mjs";
import {
  closeOwnedBrowser,
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
const root = ownedPath(resolve(evidenceRoot, run)),
  secondRoot = ownedPath(resolve(root, "device-b"));
const credentials = await disposableCredentials();
const report = {
  environment: "lab",
  source: expected.source,
  result: "blocked",
  stage: "owned-fixture-open",
  delayMsPerHttpRequest: 1500,
  realHttpRequestsDelayed: 0,
  delayedRequestOwners: { page: 0, workerOrUnbound: 0 },
  bandwidthOrPacketLossSimulated: false,
  cleanup: [],
};
let context,
  profile,
  timer,
  delaying = false,
  expired = false;
async function scenario() {
  profile = ownedPath(resolve(root, "profile-a"));
  context = await chromium.launchPersistentContext(profile, { headless: true });
  await ordinaryLogin(context, credentials, root, "a-login-slow-network");
  await observeOwnCollectionBinding(context);
  const page = await context.newPage();
  const collection = await openOwnPairedCollection(page, expected.url);
  const journey = new UserJourney(page, root);
  const title = `[test] e2e-${run} slow transport task`,
    editedTitle = `${title} edited`;
  report.stage = "create-one-slow-transport-fixture";
  await journey.createTask(title, { action: "slow-transport-task-create" });
  await journey.openTask(title);
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    // Delay only the real SDK HTTP-log nonce/RPC transport. No request body,
    // signed header, response or receipt is read/replaced, and no mocks are used.
    if (delaying && ["/v1/nonce", "/v1/rpc"].includes(url.pathname)) {
      report.realHttpRequestsDelayed++;
      try {
        if (request.frame()) report.delayedRequestOwners.page++;
        else report.delayedRequestOwners.workerOrUnbound++;
      } catch {
        report.delayedRequestOwners.workerOrUnbound++;
      }
      await delay(report.delayMsPerHttpRequest);
    }
    await route.continue().catch(() => undefined);
  });
  report.stage = "single-edit-under-real-http-delay";
  delaying = true;
  const start = performance.now();
  if (expired) throw Error("Scenario already expired before edit");
  await once(root, "slow-transport-title-edit", () =>
    page.getByLabel("Task title", { exact: true }).fill(editedTitle),
  );
  await delay(1000);
  report.statusAfterOneSecond = await page.locator(".save-state").innerText();
  report.alertsAfterOneSecond = (
    await page.getByRole("alert").allTextContents()
  ).map(redact);
  await expect(page.locator(".save-state")).toHaveText("Saved", {
    timeout: 45000,
  });
  report.savedMs = Math.round(performance.now() - start);
  if (!report.realHttpRequestsDelayed)
    throw Error(
      "No genuine mutation transport requests were delayed; slow-network coverage unqualified",
    );
  report.titleStillMatches =
    (await page.getByLabel("Task title", { exact: true }).inputValue()) ===
    editedTitle;
  delaying = false;
  await context.unrouteAll({ behavior: "wait" });
  report.cleanup.push(await closeOwnedBrowser(context, profile));
  context = null;
  if (expired)
    throw Error("Scenario already expired before independent readback");
  profile = ownedPath(resolve(secondRoot, "profile-b"));
  context = await chromium.launchPersistentContext(profile, { headless: true });
  await ordinaryLogin(
    context,
    credentials,
    secondRoot,
    "b-login-slow-network-readback",
  );
  await observeOwnCollectionBinding(context);
  const other = await context.newPage();
  if ((await openOwnPairedCollection(other, expected.url)) !== collection)
    throw Error("Independent readback fixture mismatch");
  report.stage = "second-device-readback";
  await expect(
    other.getByRole("button", { name: editedTitle, exact: true }),
  ).toBeVisible({ timeout: 30000 });
  report.secondDeviceSeesEditedTask = true;
  report.result = "passed";
}
try {
  await Promise.race([
    scenario(),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        reject(
          Error(
            "Slow-network scenario deadline; inspect original marker/state before any repeat",
          ),
        );
      }, 150000);
    }),
  ]);
} catch (error) {
  report.error = redact(error.message);
} finally {
  clearTimeout(timer);
  delaying = false;
  if (context) report.cleanup.push(await closeOwnedBrowser(context, profile));
  await saveReport(resolve(root, "slow-network-report.json"), report);
}
console.log(
  JSON.stringify({
    result: report.result,
    stage: report.stage,
    savedMs: report.savedMs,
    requestsDelayed: report.realHttpRequestsDelayed,
    evidence: resolve(root, "slow-network-report.json"),
  }),
);
