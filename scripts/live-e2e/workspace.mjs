import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";
import { disposableCredentials } from "./credentials.mjs";
import { assertAccount } from "./browser-flow.mjs";
import { performance } from "node:perf_hooks";
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

const [mode, run, ready] = process.argv.slice(2);
if (
  ![
    "create",
    "inspect",
    "tasks",
    "persist-archive-delete",
    "views",
    "custom-views",
    "other-surfaces",
    "settings",
    "recurrence",
    "recurrence-continue",
    "recurrence-complete-row",
    "offline",
  ].includes(mode) ||
  !/^[a-z0-9-]+$/.test(run ?? "") ||
  !ready ||
  process.env.E2E_LAB_SCOPE !== "fresh-disposable-profile"
)
  throw Error(
    "Explicit disposable LAB scope +create|inspect|tasks +run +READY required",
  );
await verifyServed(ready);
const root = ownedPath(resolve(evidenceRoot, run));
const reportPath = resolve(
  root,
  `${mode}-workspace-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
const report = {
  environment: "lab",
  source: expected.source,
  result: "blocked",
  stage: "reopen-own-device",
  timings: {},
  clicks: 0,
};
const context = await chromium.launchPersistentContext(
  resolve(root, "profile-a"),
  { headless: true, viewport: { width: 1440, height: 1000 } },
);
const page = await context.newPage();
const journey = new UserJourney(page, root);
try {
  const credentials = await disposableCredentials();
  await assertAccount(context, credentials.accountId);
  report.accountMatched = true;
  await page.goto(expected.url);
  async function click(name) {
    await page.getByRole("button", { name, exact: true }).click();
    report.clicks++;
    await expect(page.locator("main")).toHaveAttribute("aria-busy", "false", {
      timeout: 65000,
    });
    if (await page.getByRole("alert").count())
      throw Error(redact(await page.getByRole("alert").innerText()));
  }
  await click("Resume this device's original sign-in");
  await click("Confirm this account on this device");
  await click("Refresh approved collections");
  report.collectionCountBefore = await page.locator("section ul li").count();
  if (mode === "create") {
    if (report.collectionCountBefore !== 0)
      throw Error(
        "Expected empty creation-only approval; refusing new collection",
      );
    report.stage = "create-own-disposable-collection";
    report.nameInputPresent = (await page.getByRole("textbox").count()) > 0;
    const started = performance.now();
    await once(root, "create-collection", () => click("Create collection"));
    await expect(page.getByRole("status")).toContainText(
      "Collection creation recorded",
      { timeout: 30000 },
    );
    report.timings.createCollectionMs = Math.round(performance.now() - started);
    await click("Refresh approved collections");
  }
  const choices = page.locator("section ul li");
  report.collectionCountAfter = await choices.count();
  if (report.collectionCountAfter !== 1)
    throw Error("Own creation-only scope is not exactly one collection; stop");
  report.stage = "open-own-collection";
  const openStart = performance.now();
  await choices.getByRole("button").click();
  report.clicks++;
  await page
    .getByRole("heading", { name: "Set up TaskNotes", exact: true })
    .or(page.getByRole("heading", { name: "Today", exact: true, level: 1 }))
    .waitFor({ timeout: 65000 });
  report.timings.openCollectionMs = Math.round(performance.now() - openStart);
  report.setupShown = await page
    .getByRole("heading", { name: "Set up TaskNotes", exact: true })
    .isVisible();
  if (report.setupShown && mode === "create") {
    report.stage = "first-setup";
    report.screenshotBeforeSetup = await journey.screenshot(
      "new-collection-manual-setup",
    );
    const setupStart = performance.now();
    await once(root, "setup-own-collection", () =>
      page
        .getByRole("button", { name: "Set up TaskNotes", exact: true })
        .click(),
    );
    report.clicks++;
    await page
      .getByRole("heading", { name: "Today", exact: true, level: 1 })
      .waitFor({ timeout: 65000 });
    report.timings.setupToFirstViewMs = Math.round(
      performance.now() - setupStart,
    );
  }
  if (report.setupShown && mode !== "create")
    throw Error("Configured own collection unexpectedly returned to setup");
  if (mode === "settings") {
    report.stage = "settings-open";
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("heading", { name: "Settings", exact: true })
      .waitFor();
    report.settingsText = redact(await page.locator("body").innerText());
  }
  if (mode === "offline") {
    report.stage = "offline-task-create";
    const title = `[test] e2e-${run} offline task`;
    await journey.createTask(title, { action: "offline-task-create" });
    await journey.openTask(title);
    await context.setOffline(true);
    const offlineStarted = performance.now();
    await once(root, "offline-task-edit", () =>
      page
        .getByLabel("Task title", { exact: true })
        .fill(`${title} edited offline`),
    );
    report.stage = "offline-edit-status";
    await page.waitForTimeout(10000);
    report.offlineElapsedMs = Math.round(performance.now() - offlineStarted);
    report.offlineSaveStatus = await page.locator(".save-state").innerText();
    report.offlineAlerts = (
      await page.getByRole("alert").allTextContents()
    ).map(redact);
    report.screenshotOffline = await journey.screenshot("offline-edit-status");
    report.stage = "reconnect-original-edit";
    const reconnectStarted = performance.now();
    await context.setOffline(false);
    await expect(page.locator(".save-state")).toHaveText("Saved", {
      timeout: 65000,
    });
    report.timings.reconnectToSavedMs = Math.round(
      performance.now() - reconnectStarted,
    );
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(
      page.getByRole("button", {
        name: `${title} edited offline`,
        exact: true,
      }),
    ).toBeVisible({ timeout: 30000 });
    report.originalEditVisibleAfterReconnect = true;
    report.journeys = journey.reportPath;
  }
  if (mode === "recurrence-complete-row") {
    const title = `[test] e2e-${run} recurring task`;
    report.stage = "recurring-row-completion";
    await journey.measure(
      "recurring-row-complete",
      () =>
        journey.click(
          page.getByRole("button", { name: `Complete ${title}`, exact: true }),
        ),
      () =>
        expect(
          page.getByRole("button", { name: `Complete ${title}`, exact: true }),
        ).toHaveCount(0),
      { mutating: true },
    );
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page
      .getByRole("searchbox", { name: "Search tasks", exact: true })
      .fill(title);
    await journey.openTask(title);
    report.recurringSeriesRemainsOpen = await page
      .getByRole("button", { name: "Complete task", exact: true })
      .isVisible();
    report.seriesCompletedInstead = await page
      .getByRole("button", { name: "Reopen task", exact: true })
      .isVisible();
    report.journeys = journey.reportPath;
    if (!report.recurringSeriesRemainsOpen)
      throw Error(
        "Recurring row completion completed the series instead of one occurrence",
      );
  }
  if (mode === "recurrence" || mode === "recurrence-continue") {
    report.stage = "recurring-task-create";
    const title = `[test] e2e-${run} recurring task`;
    if (mode === "recurrence")
      await journey.createTask(title, { action: "recurring-task-create" });
    await journey.openTask(title);
    await page.getByText("Repeat and reminders", { exact: true }).click();
    await page.getByRole("combobox", { name: "Repeat", exact: true }).click();
    await journey.measure(
      "recurring-task-set-daily",
      async () => {
        await journey.click(
          page.getByRole("option", { name: "Daily", exact: true }),
        );
        await journey.click(
          page.getByRole("button", { name: "Back", exact: true }),
        );
      },
      () =>
        expect(
          page.getByRole("button", { name: title, exact: true }),
        ).toBeVisible({ timeout: 30000 }),
      { mutating: true },
    );
    await journey.openTask(title);
    await expect(page.locator(".occurrence-banner")).toBeVisible();
    report.stage = "recurring-occurrence-complete";
    await journey.measure(
      "recurring-occurrence-complete",
      () =>
        journey.click(
          page.getByRole("button", { name: "Complete", exact: true }),
        ),
      () =>
        expect(
          page.getByRole("button", { name: "Mark open", exact: true }),
        ).toBeVisible({ timeout: 30000 }),
      { mutating: true },
    );
    report.journeys = journey.reportPath;
  }
  if (mode === "persist-archive-delete") {
    report.stage = "completed-task-persistence";
    const title = `[test] e2e-${run} task edited`;
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page
      .getByRole("searchbox", { name: "Search tasks", exact: true })
      .fill(title);
    await journey.openTask(title);
    await expect(
      page.getByRole("button", { name: "Reopen task", exact: true }),
    ).toBeVisible();
    report.reloadedTaskTitleAndCompletionPersisted = true;
    report.screenshotPersistence = await journey.screenshot(
      "completed-task-persistence",
    );
    report.stage = "archive-task";
    await page
      .getByRole("button", { name: "More task actions", exact: true })
      .click();
    await journey.measure(
      "task-archive",
      () =>
        page.getByRole("menuitem", { name: "Archive", exact: true }).click(),
      () =>
        expect(
          page.getByRole("region", { name: "Task details", exact: true }),
        ).toHaveCount(0),
      { mutating: true },
    );
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await journey.openTask(title);
    report.archiveVisibleInArchiveView = true;
    report.stage = "delete-owned-task";
    await page
      .getByRole("button", { name: "More task actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await journey.measure(
      "task-delete",
      () =>
        page.getByRole("button", { name: "Delete task", exact: true }).click(),
      () =>
        expect(
          page.getByRole("region", { name: "Task details", exact: true }),
        ).toHaveCount(0),
      { mutating: true },
    );
    report.undoOffered = await page
      .getByRole("button", { name: "Undo", exact: true })
      .isVisible();
    await page.waitForTimeout(32000); // Exercise the advertised recovery window, no repeated submit.
    report.deletedTaskAbsent =
      (await page.getByRole("button", { name: title, exact: true }).count()) ===
      0;
    report.journeys = journey.reportPath;
  }
  if (mode === "other-surfaces") {
    report.stage = "deleted-task-reload-persistence";
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page
      .getByRole("searchbox", { name: "Search tasks", exact: true })
      .fill(`[test] e2e-${run} task edited`);
    await expect(
      page.getByText("No tasks matched.", { exact: true }),
    ).toBeVisible({ timeout: 20000 });
    report.deletedTaskAbsentAfterRestart = true;
    report.stage = "scratchpad-open";
    await once(root, "scratchpad-first-open", () =>
      page.getByRole("button", { name: "Scratchpad", exact: true }).click(),
    );
    await page
      .getByRole("heading", { name: "Scratchpad", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Write", exact: true })
      .waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: "Write", exact: true }).click();
    report.stage = "scratchpad-edit";
    const current = page.getByRole("region", {
      name: "Editor for current scratchpad",
      exact: true,
    });
    await journey.measure(
      "scratchpad-edit",
      () =>
        current
          .getByRole("textbox", { name: "Scratchpad Markdown", exact: true })
          .fill(`[test] e2e-${run} scratchpad text`),
      () =>
        expect(current.getByRole("status")).toHaveText("Saved", {
          timeout: 30000,
        }),
      { mutating: true },
    );
    report.scratchpadSaved = true;
    report.screenshotScratchpad = await journey.screenshot("scratchpad-saved");
    report.stage = "settings-open";
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("heading", { name: "Settings", exact: true })
      .waitFor();
    report.settingsText = redact(await page.locator("body").innerText());
    report.journeys = journey.reportPath;
  }
  if (mode === "custom-views") {
    report.stage = "custom-view-create";
    const name = `[test] e2e-${run} view`;
    await page
      .getByRole("button", { name: "Manage views", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Create view", exact: true })
      .click();
    await page.getByLabel("View name", { exact: true }).fill(name);
    await journey.measure(
      "view-create",
      () =>
        journey.click(
          page.getByRole("button", { name: "Save view", exact: true }),
        ),
      () =>
        expect(
          page.getByRole("button", {
            name: `More actions for ${name}`,
            exact: true,
          }),
        ).toBeVisible({ timeout: 30000 }),
      { mutating: true },
    );
    report.stage = "custom-view-edit";
    await page
      .getByRole("button", { name: `More actions for ${name}`, exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
    await page.getByLabel("View name", { exact: true }).fill(`${name} edited`);
    await page.getByRole("button", { name: /^Group & sort/ }).click();
    await page
      .getByRole("combobox", { name: "Group by", exact: true })
      .fill("status");
    await page
      .getByRole("combobox", { name: "Group by", exact: true })
      .press("Enter");
    await page
      .getByRole("combobox", { name: "Property to sort", exact: true })
      .fill("title");
    await page
      .getByRole("combobox", { name: "Property to sort", exact: true })
      .press("Enter");
    await page
      .getByRole("region", { name: "Group & sort", exact: true })
      .getByRole("button", { name: "Add", exact: true })
      .click();
    await page.getByRole("button", { name: /^Filter/ }).click();
    await page.getByRole("button", { name: "Advanced", exact: true }).click();
    await page
      .getByLabel("Filter expression", { exact: true })
      .fill('note["archived"] != true');
    await journey.measure(
      "view-edit",
      () =>
        journey.click(
          page.getByRole("button", { name: "Save view", exact: true }),
        ),
      () =>
        expect(
          page.getByRole("button", {
            name: `More actions for ${name} edited`,
            exact: true,
          }),
        ).toBeVisible({ timeout: 30000 }),
      { mutating: true },
    );
    report.journeys = journey.reportPath;
  }
  if (mode === "views") {
    report.stage = "default-view-navigation";
    for (const name of ["Upcoming", "Calendar", "Projects", "Archive", "Today"])
      await journey.openView(name);
    report.journeys = journey.reportPath;
  }
  if (mode === "tasks") {
    report.stage = "task-create-edit-complete";
    const title = `[test] e2e-${run} task`;
    await journey.createTask(title);
    await journey.openTask(title);
    const edited = `${title} edited`;
    await journey.editTaskTitle(edited);
    await journey.openTask(edited);
    await journey.completeTask();
    report.journeys = journey.reportPath;
  }
  report.stage = "workspace-visible";
  report.uiText = redact(await page.locator("body").innerText());
  report.screenshot = await journey.screenshot(`${mode}-workspace`);
  report.result = "passed";
} catch (error) {
  report.error = redact(error.message);
  report.uiText = redact(
    await page
      .locator("body")
      .innerText()
      .catch(() => "Unavailable"),
  );
  report.screenshot = await journey
    .screenshot(`${mode}-workspace-failure`)
    .catch(() => null);
} finally {
  await context.setOffline(false).catch(() => {});
  await context.close();
  report.cleanup = "owned-browser-stopped-profile-retained";
  await saveReport(reportPath, report);
}
console.log(
  JSON.stringify({
    result: report.result,
    stage: report.stage,
    evidence: reportPath,
    timings: report.timings,
  }),
);
if (report.result !== "passed") process.exitCode = 1;
