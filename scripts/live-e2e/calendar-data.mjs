import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";
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
  source: expected.source,
  result: "blocked",
  stage: "own-fixture-open",
  cleanup: [],
};
let context,
  profile,
  timer,
  expired = false;
async function scenario() {
  const title = `[test] e2e-${run} slow transport task edited`;
  profile = ownedPath(resolve(root, "profile-a"));
  context = await chromium.launchPersistentContext(profile, { headless: true });
  await ordinaryLogin(context, credentials, root, "calendar-data-login-a");
  await observeOwnCollectionBinding(context);
  const page = await context.newPage();
  const collection = await openOwnPairedCollection(page, expected.url);
  const journey = new UserJourney(page, root);
  await journey.openTask(title);
  await page.getByText("Schedule and status", { exact: true }).click();
  await page
    .getByRole("button", { name: "Scheduled date", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "Scheduled date calendar",
    exact: true,
  });
  report.stage = "schedule-own-task-today-once";
  await once(root, "calendar-owned-task-schedule-today", () =>
    picker.getByRole("button", { name: "Today", exact: true }).click(),
  );
  await expect(page.locator(".save-state")).toHaveText("Saved", {
    timeout: 45000,
  });
  report.scheduleSaved = true;
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await journey.openView("Calendar");
  report.stage = "calendar-positive-data";
  const event = page
    .locator(".full-calendar-event-content")
    .filter({ hasText: title });
  await expect(event.first()).toBeVisible({ timeout: 20000 });
  report.calendarEventVisible = true;
  report.calendarAlerts = (await page.getByRole("alert").allTextContents()).map(
    redact,
  );
  report.screenshot = await journey.screenshot("calendar-positive-data");
  const cleanup = await closeOwnedBrowser(context, profile);
  report.cleanup.push(cleanup);
  assertBrowserStopped(cleanup);
  context = null;
  if (expired) throw Error("Calendar scenario already expired");
  profile = ownedPath(resolve(secondRoot, "profile-b"));
  context = await chromium.launchPersistentContext(profile, { headless: true });
  await ordinaryLogin(
    context,
    credentials,
    secondRoot,
    "calendar-data-login-b",
  );
  await observeOwnCollectionBinding(context);
  const other = await context.newPage();
  if ((await openOwnPairedCollection(other, expected.url)) !== collection)
    throw Error("Calendar readback fixture mismatch");
  const otherJourney = new UserJourney(other, secondRoot);
  await otherJourney.openTask(title);
  report.stage = "independent-date-readback";
  report.otherDeviceShowsScheduledToday = await other
    .getByText("Scheduled Today", { exact: true })
    .isVisible();
  await other.getByRole("button", { name: "Back", exact: true }).click();
  await otherJourney.openView("Calendar");
  await expect(
    other
      .locator(".full-calendar-event-content")
      .filter({ hasText: title })
      .first(),
  ).toBeVisible({ timeout: 20000 });
  report.otherDeviceCalendarEventVisible = true;
  report.result =
    report.otherDeviceShowsScheduledToday && !report.calendarAlerts.length
      ? "passed"
      : "failed";
}
try {
  await Promise.race([
    scenario(),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        reject(
          Error(
            "Calendar scenario deadline; do not repeat original date submission",
          ),
        );
      }, 150000);
    }),
  ]);
} catch (error) {
  report.error = redact(error.message);
} finally {
  clearTimeout(timer);
  if (context) report.cleanup.push(await closeOwnedBrowser(context, profile));
  await saveReport(resolve(root, "calendar-data-report.json"), report);
}
console.log(
  JSON.stringify({
    result: report.result,
    stage: report.stage,
    evidence: resolve(root, "calendar-data-report.json"),
  }),
);
