import { expect, test } from "@playwright/test";
import { buildTaskNotesMdbaseResources } from "@tasknotes/model/mdbase";

const templatedType = buildTaskNotesMdbaseResources().typeDocument.replace(
  "  compatibility:\n",
  `  templating:
    enabled: true
    template_path: Templates/Task.md
    failure_mode: error
    unknown_variable_policy: preserve
  compatibility:
`,
);

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await page.evaluate(async () => {
    localStorage.clear();
    indexedDB.deleteDatabase("tasknotes-index-v2");
    const root = await navigator.storage.getDirectory();
    await root
      .removeEntry("TaskNotes", { recursive: true })
      .catch(() => undefined);
  });
  await page.reload();
  await page.getByRole("button", { name: /On this device/ }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
});

test("edits planning fields, recurrence, reminders, and upcoming tasks", async ({
  page,
}) => {
  await page.getByLabel("New task title").fill("Prepare weekly review");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("Prepare weekly review", { exact: true }).click();

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowValue = [
    tomorrow.getFullYear(),
    String(tomorrow.getMonth() + 1).padStart(2, "0"),
    String(tomorrow.getDate()).padStart(2, "0"),
  ].join("-");
  await page.getByLabel("Scheduled date", { exact: true }).fill(tomorrowValue);
  await page.getByLabel("Projects").fill("mdbase");
  await page.getByLabel("Contexts").fill("computer");
  await page.getByLabel("Tags").fill("release, planning");
  await page.getByLabel("Repeat").selectOption("weekly");
  await page.getByRole("button", { name: "Customize" }).click();
  await page.getByLabel("Repeat interval").fill("2");
  await page.getByRole("button", { name: "Monday" }).click();
  await page.getByLabel("Ends").selectOption("count");
  await page.getByRole("spinbutton", { name: "Occurrences" }).fill("6");
  await page
    .getByLabel("Reminder date and time")
    .fill(`${tomorrowValue}T09:00`);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  await page.getByRole("button", { name: "Upcoming" }).click();
  await expect(
    page.getByText("Prepare weekly review", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Views", exact: true }).click();
  await page.getByRole("button", { name: "Search tasks" }).click();
  await page.getByLabel("Search tasks").fill("mdbase computer release");
  await expect(
    page.getByText("Prepare weekly review", { exact: true }),
  ).toBeVisible();
});

test("creates, edits, searches, completes, and reloads a Markdown task", async ({
  page,
}) => {
  await page.getByLabel("New task title").fill("Review Capacitor storage");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText("Review Capacitor storage", { exact: true }),
  ).toBeVisible();

  await page.getByText("Review Capacitor storage", { exact: true }).click();
  const title = page.getByLabel("Task title", { exact: true });
  await title.fill("Review web-native storage");
  await page.getByText("Normal", { exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  await page.getByRole("button", { name: "Views", exact: true }).click();
  await page.getByRole("button", { name: "Search tasks" }).click();
  await page.getByLabel("Search tasks").fill("web-native");
  await expect(
    page.getByText("Review web-native storage", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Complete Review web-native storage" })
    .click();
  await expect(
    page.getByRole("button", { name: "Reopen Review web-native storage" }),
  ).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Views", exact: true }).click();
  await page.getByRole("button", { name: "Search tasks" }).click();
  await page.getByLabel("Search tasks").fill("web-native");
  await expect(
    page.getByText("Review web-native storage", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reopen Review web-native storage" }),
  ).toBeVisible();
});

test("saves in the background while navigating away", async ({ page }) => {
  await page.getByLabel("New task title").fill("Background save");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("Background save", { exact: true }).click();
  await page
    .getByLabel("Task title", { exact: true })
    .fill("Background save completed");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByText("Background save completed", { exact: true }),
  ).toBeVisible();
});

test("archives and restores a Markdown task without deleting it", async ({
  page,
}) => {
  await page.getByLabel("New task title").fill("Keep archived history");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("Keep archived history", { exact: true }).click();
  await page.getByLabel("Archive task").click();
  await expect(
    page.getByText("Keep archived history", { exact: true }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: /Archive.*1 archived task/ }).click();
  await expect(page.getByRole("heading", { name: "Archive" })).toBeVisible();
  await page.getByText("Keep archived history", { exact: true }).click();
  await page.getByLabel("Restore task").click();
  await expect(page.getByText("Nothing archived.")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(
    page.getByText("Keep archived history", { exact: true }),
  ).toBeVisible();
});

test("interprets natural-language capture and preserves timed task fields", async ({
  page,
}) => {
  await page
    .getByLabel("New task title")
    .fill(
      "Prepare launch tomorrow 9am #release @computer +mdbase every week 45m !high *in-progress",
    );
  await expect(
    page.getByText("Tomorrow", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByText("Weekly", { exact: true })).toBeVisible();
  await expect(page.getByText("45 min", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await page.getByRole("button", { name: "Upcoming" }).click();
  await page
    .getByRole("button", { name: /^Prepare launch / })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "In progress" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "High", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Scheduled time")).toHaveValue("09:00");
  await expect(page.getByLabel("Estimate (minutes)")).toHaveValue("45");
  await expect(page.getByLabel("Projects")).toHaveValue("mdbase");
  await expect(page.getByLabel("Contexts")).toHaveValue("computer");
  await expect(page.getByLabel("Tags")).toHaveValue("release");
});

test("projects, completes, and skips recurring occurrences by date", async ({
  page,
}) => {
  await page
    .getByLabel("New task title")
    .fill("Daily standup today 9am every day");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: /^Daily standup Today,/ }).click();
  await expect(page.getByText("Occurrence", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(page.getByRole("button", { name: "Mark open" })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^Daily standup Today,/ }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Upcoming" }).click();
  const firstUpcoming = page
    .getByText("Daily standup", { exact: true })
    .first();
  await expect(firstUpcoming).toBeVisible();
  await firstUpcoming.click();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unskip" })).toBeVisible();
});

test("materializes one durable occurrence and reconciles it after reload", async ({
  page,
}) => {
  await page
    .getByLabel("New task title")
    .fill("Materialized review today every day");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page
    .getByRole("button", { name: /^Materialized review Today/ })
    .click();
  await page.getByRole("button", { name: "Make occurrence note" }).click();
  await expect(
    page.getByText("Occurrence note", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(page.getByRole("button", { name: "Mark open" })).toBeVisible();

  await page.reload();
  await expect(
    page.getByText("Occurrence note", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Materialized review Today/ }),
  ).toHaveCount(0);
  const persisted = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const tasknotes = await root.getDirectoryHandle("TaskNotes");
    const tasks = await tasknotes.getDirectoryHandle("tasks");
    const documents: string[] = [];
    for await (const [, handle] of tasks.entries()) {
      if (handle.kind !== "file") continue;
      documents.push(await (await handle.getFile()).text());
    }
    return {
      occurrences: documents.filter((source) =>
        source.includes("occurrence_date:"),
      ).length,
      parentReconciled: documents.some((source) =>
        source.includes("complete_instances:"),
      ),
    };
  });
  expect(persisted).toEqual({ occurrences: 1, parentReconciled: true });
});

test("tracks, edits, persists, and removes work sessions", async ({ page }) => {
  await page.getByLabel("New task title").fill("Measure mobile performance");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("Measure mobile performance", { exact: true }).click();

  await page.getByLabel("Timer description").fill("Cold start profile");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText(/Cold start profile ·/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
  await page.getByRole("button", { name: "1 session" }).click();
  await page.getByText("Cold start profile", { exact: true }).click();
  await page.getByLabel("Session description").fill("Warm start profile");
  await page.getByRole("button", { name: "Save session" }).click();
  await expect(
    page.getByText("Warm start profile", { exact: true }),
  ).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "1 session" }).click();
  await expect(
    page.getByText("Warm start profile", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove Warm start profile" }).click();
  await expect(page.getByRole("button", { name: "1 session" })).toHaveCount(0);
});

test("keeps timers on different tasks independent", async ({ page }) => {
  for (const title of ["Parallel research", "Parallel build"]) {
    const input = page.getByLabel("New task title");
    await input.fill(title);
    await input.press("Enter");
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  }

  await page.getByText("Parallel research", { exact: true }).click();
  await page.getByLabel("Timer description").fill("Research");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  await page.getByText("Parallel build", { exact: true }).click();
  await page.getByLabel("Timer description").fill("Build");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  await page.getByText("Parallel research", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByText("Parallel build", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
});

test("creates a task from the collection's configured Markdown template", async ({
  page,
}) => {
  await page.evaluate(
    async ({ typeDocument }) => {
      const root = await navigator.storage.getDirectory();
      const tasknotes = await root.getDirectoryHandle("TaskNotes", {
        create: true,
      });
      const types = await tasknotes.getDirectoryHandle("_types", {
        create: true,
      });
      const type = await types.getFileHandle("task.md", { create: true });
      const typeWriter = await type.createWritable();
      await typeWriter.write(typeDocument);
      await typeWriter.close();
      const templates = await tasknotes.getDirectoryHandle("Templates", {
        create: true,
      });
      const template = await templates.getFileHandle("Task.md", {
        create: true,
      });
      const templateWriter = await template.createWritable();
      await templateWriter.write(`---
source: mobile-template
status: done
---
# {{title}}

Created on {{date}} from the collection template.`);
      await templateWriter.close();
    },
    { typeDocument: templatedType },
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();

  await page.getByLabel("New task title").fill("Template-backed task");
  await page.getByRole("button", { name: "Details" }).click();
  await expect(
    page.getByText(/Use template · Templates\/Task.md/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("Template-backed task", { exact: true }).click();
  await expect(page.getByLabel("Notes")).toHaveValue(/Created on/);
  await expect(page.getByRole("button", { name: "Open" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("renders configured saved-view properties in every result list", async ({
  page,
}, testInfo) => {
  const today = [
    new Date().getFullYear(),
    String(new Date().getMonth() + 1).padStart(2, "0"),
    String(new Date().getDate()).padStart(2, "0"),
  ].join("-");

  await page.getByLabel("New task title").fill("Plan saved views");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("Plan saved views", { exact: true }).click();
  await page.getByLabel("Due date", { exact: true }).fill(today);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  await page.getByLabel("New task title").fill("Ship saved views");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Complete Ship saved views" }).click();

  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const tasknotes = await root.getDirectoryHandle("TaskNotes", {
      create: true,
    });
    const views = await tasknotes.getDirectoryHandle("views", {
      create: true,
    });
    const file = await views.getFileHandle("work.base", { create: true });
    const writable = await file.createWritable();
    await writable.write(`formulas:
  progress: if(status == "done", "Complete", "Active")
properties:
  note.status:
    displayName: State
  formula.progress:
    displayName: Progress
views:
  - type: tasknotesKanban
    name: Work board
    groupBy:
      property: status
      direction: ASC
    order: [status, formula.progress]
  - type: tasknotesTaskList
    name: Task details
    order: [status, formula.progress]
  - type: tasknotesCalendar
    name: Dates
    order: [due, file.name]
    options:
      showDue: true
      showScheduled: false
`);
    await writable.close();
  });

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: /Saved views/ }).click();
  await expect(page.getByRole("heading", { name: "Views" })).toBeVisible();
  await expect(page.getByText("Work board", { exact: true })).toBeVisible();
  await expect(page.getByText("Task details", { exact: true })).toBeVisible();
  await expect(page.getByText("Dates", { exact: true })).toBeVisible();

  await page
    .getByRole("button", { name: "Add Work board to navigation" })
    .click();
  await page
    .getByRole("button", { name: "Work board work", exact: true })
    .click();
  await expect(page.getByLabel("Work board board")).toBeVisible();
  await expect(
    page.getByText("Plan saved views", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Ship saved views", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Progress", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Work board", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  await page.reload();
  await expect(page.getByLabel("Work board board")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Work board", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: /Saved views/ }).click();
  await page.getByText("Task details", { exact: true }).click();
  await expect(page.getByText("State", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("Progress", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Complete", { exact: true })).toBeVisible();

  await page
    .locator("#main-content")
    .getByRole("button", { name: "Views", exact: true })
    .click();
  await page.getByText("Dates", { exact: true }).click();
  await expect(page.getByRole("grid")).toBeVisible();
  await expect(
    page
      .locator(".calendar-agenda .task-row-title")
      .getByText("Plan saved views", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Due", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Progress", { exact: true })).toHaveCount(0);
  if (testInfo.project.name === "desktop") {
    await expect(
      page.locator(".calendar-cell-tasks").getByText("Plan saved views"),
    ).toBeVisible();
    const calendar = await page.locator(".calendar-grid").boundingBox();
    const agenda = await page.locator(".calendar-agenda").boundingBox();
    expect(calendar).not.toBeNull();
    expect(agenda).not.toBeNull();
    expect(agenda!.x).toBeGreaterThan(calendar!.x + calendar!.width);
  }
  await page
    .locator("#main-content")
    .getByRole("button", { name: "Views", exact: true })
    .click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByRole("heading", { name: "More" })).toBeVisible();
});

test("offers task actions without opening the editor", async ({ page }) => {
  await page.getByLabel("New task title").fill("Act from the task row");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await page
    .getByRole("button", { name: "Task actions for Act from the task row" })
    .click();
  await page.getByRole("menuitem", { name: "Start timer" }).click();

  await page
    .getByRole("button", { name: "Task actions for Act from the task row" })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Stop timer" }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(
    page.getByText("Act from the task row", { exact: true }),
  ).toHaveCount(0);
});

test("keeps the task workspace visible beside the desktop editor", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  await page.getByLabel("New task title").fill("Inspect beside the list");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("Inspect beside the list", { exact: true }).click();

  const inspector = page.getByRole("complementary", { name: "Task details" });
  await expect(inspector).toBeVisible();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByLabel("Task title", { exact: true })).toHaveValue(
    "Inspect beside the list",
  );
  const workspace = await page.locator("#main-content").boundingBox();
  const details = await inspector.boundingBox();
  expect(details).not.toBeNull();
  expect(workspace).not.toBeNull();
  expect(details!.x).toBeGreaterThanOrEqual(workspace!.x + workspace!.width);
});

test("uses a full-screen task editor on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile");
  await page.getByLabel("New task title").fill("Edit on a phone");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("Edit on a phone", { exact: true }).click();

  await expect(
    page.getByRole("complementary", { name: "Task details" }),
  ).toBeVisible();
  await expect(page.locator("#main-content")).toBeHidden();
  await expect(page.getByLabel("Task title", { exact: true })).toHaveValue(
    "Edit on a phone",
  );
});
