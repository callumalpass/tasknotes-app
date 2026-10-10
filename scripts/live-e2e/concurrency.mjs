import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { disposableCredentials } from "./credentials.mjs";
import {
  assertSingleBrowserPolicy,
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
  ordinaryLogin,
  observeOwnCollectionBinding,
  openOwnPairedCollection,
} from "./browser-flow.mjs";

// Retain the historical diagnostic, but never allow its two-browser launch.
assertSingleBrowserPolicy(2);
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
  stage: "open-two-owned-devices",
  collectionMatched: false,
};
let a, b, pageA, pageB;
try {
  a = await chromium.launchPersistentContext(resolve(root, "profile-a"), {
    headless: true,
  });
  b = await chromium.launchPersistentContext(resolve(secondRoot, "profile-b"), {
    headless: true,
  });
  await ordinaryLogin(a, credentials, root, "primary-login-for-concurrency");
  await ordinaryLogin(
    b,
    credentials,
    secondRoot,
    "second-login-for-concurrency",
  );
  await observeOwnCollectionBinding(a);
  await observeOwnCollectionBinding(b);
  pageA = await a.newPage();
  pageB = await b.newPage();
  const [collectionA, collectionB] = await Promise.all([
    openOwnPairedCollection(pageA, expected.url),
    openOwnPairedCollection(pageB, expected.url),
  ]);
  if (collectionA !== collectionB)
    throw Error("Concurrent fixture binding mismatch");
  report.collectionMatched = true;
  const title = `[test] e2e-${run} offline task edited offline`;
  await Promise.all([
    new UserJourney(pageA, root).openTask(title),
    new UserJourney(pageB, secondRoot).openTask(title),
  ]);
  const changedTitle = `${title} concurrent`,
    body = `[test] e2e-${run} body from device B`;
  report.stage = "concurrent-disjoint-field-edits";
  const start = performance.now();
  await Promise.all([
    once(root, "concurrent-a-title", () =>
      pageA.getByLabel("Task title", { exact: true }).fill(changedTitle),
    ),
    once(secondRoot, "concurrent-b-body", () =>
      pageB.getByRole("textbox", { name: "Notes", exact: true }).fill(body),
    ),
  ]);
  await Promise.all(
    [pageA, pageB].map((page) =>
      expect(page.locator(".save-state")).not.toHaveText("Saving", {
        timeout: 45000,
      }),
    ),
  );
  report.elapsedMs = Math.round(performance.now() - start);
  report.saveStatusA = await pageA.locator(".save-state").innerText();
  report.saveStatusB = await pageB.locator(".save-state").innerText();
  report.alertsA = (await pageA.getByRole("alert").allTextContents()).map(
    redact,
  );
  report.alertsB = (await pageB.getByRole("alert").allTextContents()).map(
    redact,
  );
  report.screenshotA = await new UserJourney(pageA, root).screenshot(
    "concurrent-device-a",
  );
  report.screenshotB = await new UserJourney(pageB, secondRoot).screenshot(
    "concurrent-device-b",
  );
  if (report.saveStatusA !== "Saved" || report.saveStatusB !== "Saved") {
    report.result = "conflict-visible";
  } else {
    await pageA.getByRole("button", { name: "Back", exact: true }).click();
    report.changedTitlePersisted = await expect(
      pageA.getByRole("button", { name: changedTitle, exact: true }),
    )
      .toBeVisible({ timeout: 15000 })
      .then(
        () => true,
        () => false,
      );
    if (report.changedTitlePersisted) {
      await pageA
        .getByRole("button", { name: changedTitle, exact: true })
        .click();
      await pageA.getByRole("button", { name: "Write", exact: true }).click();
      report.bodyPersisted = await expect(
        pageA.getByRole("textbox", { name: "Notes", exact: true }),
      )
        .toHaveValue(body, { timeout: 15000 })
        .then(
          () => true,
          () => false,
        );
    }
    report.result =
      report.changedTitlePersisted && report.bodyPersisted
        ? "passed"
        : "failed";
  }
} catch (error) {
  report.error = redact(error.message);
} finally {
  await b?.close();
  await a?.close();
  report.cleanup = "both-owned-browsers-stopped-profiles-retained";
  await saveReport(resolve(root, "concurrency-report.json"), report);
}
console.log(
  JSON.stringify({
    result: report.result,
    stage: report.stage,
    evidence: resolve(root, "concurrency-report.json"),
  }),
);
