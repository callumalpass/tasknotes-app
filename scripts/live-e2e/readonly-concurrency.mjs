import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";
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
  closeOwnedBrowser,
  assertBrowserStopped,
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
  result: "blocked",
  stage: "readonly-restart-diagnosis",
  newMutationSubmitClicks: 0,
  originalFailureCode: null,
  originalFailureReason: null,
  originalReasonUnavailableAfterBrowserClosed: true,
  devices: [],
  cleanup: [],
};
let context,
  profile,
  firstCollection,
  timer,
  expired = false;
async function diagnose() {
  for (const device of ["a", "b"]) {
    if (expired) throw Error("Read-only scenario already expired");
    const deviceRoot = device === "a" ? root : secondRoot;
    profile = ownedPath(
      resolve(deviceRoot, device === "a" ? "profile-a" : "profile-b"),
    );
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
    });
    await ordinaryLogin(
      context,
      credentials,
      deviceRoot,
      `${device}-login-readonly-concurrency`,
    );
    await observeOwnCollectionBinding(context);
    const page = await context.newPage();
    const collection = await openOwnPairedCollection(page, expected.url);
    if (firstCollection && firstCollection !== collection)
      throw Error("Read-only device fixture mismatch");
    firstCollection = collection;
    const result = {
      device,
      collectionMatched: true,
      heldPresent: null,
      unresolvedPresent: null,
      finalTitleMatchesA: null,
      finalBodyMatchesB: null,
    };
    report.devices.push(result);
    const journey = new UserJourney(page, deviceRoot);
    await journey.openView("Settings");
    const sync = page
      .getByRole("status")
      .filter({ hasText: "Confirmed through" });
    await expect(sync).toHaveCount(1, { timeout: 30000 });
    const text = await sync.innerText();
    const held = text.match(/(\d+) held/),
      pending = text.match(/(\d+) pending/);
    if (held) result.heldPresent = Number(held[1]) > 0;
    if (pending) result.unresolvedPresent = Number(pending[1]) > 0;
    await journey.openView("Search");
    const originalTitle = `[test] e2e-${run} offline task edited offline`,
      changedTitle = `${originalTitle} concurrent`;
    await page
      .getByRole("searchbox", { name: "Search tasks", exact: true })
      .fill(originalTitle);
    const original = page.getByRole("button", {
        name: originalTitle,
        exact: true,
      }),
      changed = page.getByRole("button", { name: changedTitle, exact: true });
    await expect
      .poll(async () => (await original.count()) + (await changed.count()), {
        timeout: 20000,
      })
      .toBe(1);
    await ((await changed.count()) ? changed : original).click();
    await expect(
      page.getByRole("region", { name: "Task details", exact: true }),
    ).toBeVisible();
    result.finalTitleMatchesA =
      (await page.getByLabel("Task title", { exact: true }).inputValue()) ===
      changedTitle;
    await page.getByRole("button", { name: "Write", exact: true }).click();
    result.finalBodyMatchesB =
      (await page
        .getByRole("textbox", { name: "Notes", exact: true })
        .inputValue()) === `[test] e2e-${run} body from device B`;
    result.currentSaveProblemPresent = /Save failed/.test(
      (await page.locator(".save-state").getAttribute("aria-label")) ?? "",
    );
    const cleanup = await closeOwnedBrowser(context, profile);
    report.cleanup.push(cleanup);
    assertBrowserStopped(cleanup);
    context = null;
  }
  report.result = "observed";
}
try {
  await Promise.race([
    diagnose(),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        reject(Error("Read-only scenario deadline"));
      }, 150000);
    }),
  ]);
} catch (error) {
  report.error = redact(error.message);
} finally {
  clearTimeout(timer);
  if (context) report.cleanup.push(await closeOwnedBrowser(context, profile));
  await saveReport(resolve(root, "concurrency-readonly-report.json"), report);
}
console.log(
  JSON.stringify({
    result: report.result,
    devices: report.devices,
    evidence: resolve(root, "concurrency-readonly-report.json"),
  }),
);
