import { expect, test } from "@playwright/test";
import { buildTaskNotesMdbaseResources } from "@tasknotes/model/mdbase";

import type { Locator, Page } from "@playwright/test";

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

async function dragKanbanHandle(
  page: Page,
  handle: Locator,
  destination: Locator,
  touch: boolean,
) {
  await handle.scrollIntoViewIfNeeded();
  const sourceBox = await handle.boundingBox();
  const destinationBox = await destination.boundingBox();
  if (!sourceBox || !destinationBox)
    throw new Error("Kanban drag elements are not laid out");

  const start = {
    x: sourceBox.x + sourceBox.width / 2,
    y: sourceBox.y + sourceBox.height / 2,
  };
  const viewport = page.viewportSize();
  const end = {
    x: Math.max(
      8,
      Math.min(
        destinationBox.x + destinationBox.width / 2,
        (viewport?.width ?? destinationBox.x + destinationBox.width) - 8,
      ),
    ),
    y: Math.max(
      destinationBox.y + 8,
      Math.min(start.y, destinationBox.y + destinationBox.height - 8),
    ),
  };

  if (!touch) {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
    return;
  }

  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...start, id: 1 }],
    });
    for (let step = 1; step <= 8; step += 1) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            id: 1,
            x: start.x + ((end.x - start.x) * step) / 8,
            y: start.y + ((end.y - start.y) * step) / 8,
          },
        ],
      });
    }

    const board = page.locator(".kanban-board");
    let dropPoint: { x: number; y: number } | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await page.waitForTimeout(25);
      const [boardBox, currentDestinationBox] = await Promise.all([
        board.boundingBox(),
        destination.boundingBox(),
      ]);
      if (
        boardBox &&
        currentDestinationBox &&
        currentDestinationBox.x < boardBox.x + boardBox.width - 8 &&
        currentDestinationBox.x + currentDestinationBox.width > boardBox.x + 8
      ) {
        dropPoint = {
          x: Math.max(
            boardBox.x + 8,
            Math.min(
              currentDestinationBox.x + currentDestinationBox.width / 2,
              boardBox.x + boardBox.width - 8,
            ),
          ),
          y: Math.max(
            currentDestinationBox.y + 8,
            Math.min(
              start.y,
              currentDestinationBox.y + currentDestinationBox.height - 8,
            ),
          ),
        };
        break;
      }
    }
    if (!dropPoint)
      throw new Error("Kanban destination did not scroll into view");
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ ...dropPoint, id: 1 }],
    });
    await page.waitForTimeout(32);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
}

async function dragCalendarEvent(
  page: Page,
  event: Locator,
  destinationDay: Locator,
) {
  await event.scrollIntoViewIfNeeded();
  const [source, destination] = await Promise.all([
    event.boundingBox(),
    destinationDay.boundingBox(),
  ]);
  if (!source || !destination)
    throw new Error("Calendar drag elements are not laid out");

  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    destination.x + destination.width / 2,
    destination.y + Math.min(36, destination.height / 2),
    { steps: 12 },
  );
  await page.mouse.up();
}

async function localTaskDocuments(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const tasknotes = await root.getDirectoryHandle("TaskNotes");
    const tasks = await tasknotes.getDirectoryHandle("tasks");
    const documents: string[] = [];
    for await (const [, handle] of tasks.entries()) {
      if (handle.kind !== "file") continue;
      documents.push(await (await handle.getFile()).text());
    }
    return documents;
  });
}

async function openViewsCatalog(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^(Views|More views)$/ }).click();
}

async function chooseOption(
  scope: Page | Locator,
  label: string,
  option: string,
): Promise<void> {
  await scope.getByRole("combobox", { name: label, exact: true }).click();
  await scope.getByRole("option", { name: option, exact: true }).click();
}

async function chooseDate(
  page: Page,
  label: string,
  value: string,
): Promise<void> {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.locator(`[data-date="${value}"]`).last().click();
}

async function chooseTime(
  page: Page,
  label: string,
  value: string,
): Promise<void> {
  const [hour, minute] = value.split(":");
  await page.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: label, exact: true });
  await dialog
    .getByRole("listbox", { name: "Hour" })
    .getByRole("option", { name: hour, exact: true })
    .click();
  await dialog
    .getByRole("listbox", { name: "Minute" })
    .getByRole("option", { name: minute, exact: true })
    .click();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
}

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
  await expect(
    page.getByRole("heading", { name: "Today", level: 1 }),
  ).toBeVisible();
});

test("uses responsive TaskNotes controls instead of browser pickers", async ({
  page,
}, testInfo) => {
  await page.getByLabel("New task title").fill("Test native controls");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("Test native controls", { exact: true }).click();

  await expect(
    page.locator(
      'select, datalist, input[type="date"], input[type="time"], input[type="datetime-local"]',
    ),
  ).toHaveCount(0);

  await chooseOption(page, "Status", "In progress");
  await expect(page.getByRole("combobox", { name: "Status" })).toHaveAttribute(
    "data-value",
    "in-progress",
  );

  const date = new Date();
  date.setDate(date.getDate() + 2);
  const dateValue = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

  await page
    .getByRole("button", { name: "Scheduled date", exact: true })
    .click();
  const calendar = page.getByRole("dialog", {
    name: "Scheduled date calendar",
  });
  const calendarBox = await calendar.boundingBox();
  const viewport = page.viewportSize();
  expect(calendarBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (testInfo.project.name === "mobile") {
    expect(calendarBox!.width).toBeGreaterThanOrEqual(viewport!.width - 1);
    expect(
      Math.abs(calendarBox!.y + calendarBox!.height - viewport!.height),
    ).toBeLessThanOrEqual(1);
  } else {
    expect(calendarBox!.width).toBeLessThan(400);
  }
  await page
    .getByRole("button", { name: "Close Scheduled date calendar" })
    .click();

  await chooseDate(page, "Scheduled date", dateValue);
  await chooseTime(page, "Scheduled time", "07:05");
  await expect(
    page.getByRole("button", { name: "Scheduled date", exact: true }),
  ).toHaveAttribute("data-value", dateValue);
  await expect(
    page.getByRole("button", { name: "Scheduled time", exact: true }),
  ).toHaveAttribute("data-value", "07:05");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
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
  await chooseDate(page, "Scheduled date", tomorrowValue);
  await page.getByText("Organize", { exact: true }).click();
  await page.getByLabel("Projects").fill("mdbase");
  await page.getByLabel("Contexts").fill("computer");
  await page.getByLabel("Tags").fill("release, planning");
  await page.getByText("Repeat and reminders", { exact: true }).click();
  await chooseOption(page, "Repeat", "Weekly");
  await page.getByRole("button", { name: "Customize" }).click();
  await page.getByLabel("Repeat interval").fill("2");
  await page.getByRole("button", { name: "Monday" }).click();
  await chooseOption(page, "Ends", "After occurrences");
  await page.getByRole("spinbutton", { name: "Occurrences" }).fill("6");
  await chooseDate(page, "Reminder date", tomorrowValue);
  await chooseTime(page, "Reminder time", "09:00");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  await page.getByRole("button", { name: "Upcoming" }).click();
  await expect(
    page.locator(".full-calendar-view.is-agenda .fc-list"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next period" }).click();
  await expect(
    page.getByText("Prepare weekly review", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.locator(".full-calendar-view .fc-daygrid")).toBeVisible();
  await page.getByRole("button", { name: "Upcoming", exact: true }).click();
  await expect(
    page.locator(".full-calendar-view.is-agenda .fc-list"),
  ).toBeVisible();
  await openViewsCatalog(page);
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
  await page.getByText("Organize", { exact: true }).click();
  await page.getByText("Normal", { exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  await openViewsCatalog(page);
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
  await openViewsCatalog(page);
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
  const restoredDocuments = await localTaskDocuments(page);
  expect(restoredDocuments).toHaveLength(1);
  expect(restoredDocuments[0]).not.toMatch(/^\s*-\s+archived\s*$/m);

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
  await expect(page.getByLabel("Status")).toHaveAttribute(
    "data-value",
    "in-progress",
  );
  await page.getByText("Organize", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "High", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Scheduled time")).toHaveAttribute(
    "data-value",
    "09:00",
  );
  await expect(
    page.getByRole("button", { name: "Remove mdbase" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove computer" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove release" }),
  ).toBeVisible();
  await openTaskSection(page, "Time");
  await expect(page.getByLabel("Estimate (minutes)")).toHaveValue("45");
});

test("completes project links and creates tasks from the Projects view", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const tasknotes = await root.getDirectoryHandle("TaskNotes");
    const projects = await tasknotes.getDirectoryHandle("Projects", {
      create: true,
    });
    const project = await projects.getFileHandle("mobile.md", {
      create: true,
    });
    const writable = await project.createWritable();
    await writable.write(`---
title: Mobile roadmap
---
Project notes`);
    await writable.close();
  });
  await page.reload();

  await page.getByLabel("New task title").fill("Prepare mobile release");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("Prepare mobile release", { exact: true }).click();
  await page.getByText("Organize", { exact: true }).click();
  await page.getByLabel("Projects").fill("roadmap");
  const suggestion = page.getByRole("option", {
    name: /Mobile roadmap.*Projects\/mobile\.md/,
  });
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await expect(
    page.getByRole("button", { name: "Remove mobile" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  const directProjects = page.getByRole("button", {
    name: "Projects",
    exact: true,
  });
  if (await directProjects.count()) await directProjects.click();
  else {
    await openViewsCatalog(page);
    await page
      .locator(".view-document")
      .filter({
        has: page.getByRole("heading", {
          name: "tasknotes-app",
          exact: true,
        }),
      })
      .getByRole("button", { name: "Projects", exact: true })
      .click();
  }

  await expect(
    page.getByRole("heading", { name: "Mobile roadmap", level: 2 }),
  ).toBeVisible();
  await expect(
    page.getByText("Prepare mobile release", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add task to Mobile roadmap" })
    .click();
  await page.getByLabel("New task title").fill("Review mobile milestone");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText("Review mobile milestone", { exact: true }),
  ).toBeVisible();

  const documents = await localTaskDocuments(page);
  expect(documents).toHaveLength(2);
  expect(
    documents.some((source) =>
      /projects:\s*\n\s*-\s+['"]?\[\[Projects\/mobile\]\]['"]?/.test(source),
    ),
  ).toBe(true);
});

test("projects, completes, and skips recurring occurrences by date", async ({
  page,
}) => {
  await page
    .getByLabel("New task title")
    .fill("Daily standup today 9am every day");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Upcoming" }).click();
  await page.getByRole("button", { name: /^Daily standup Today,/ }).click();
  await expect(page.getByText("Occurrence", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(page.getByRole("button", { name: "Mark open" })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^Daily standup Today,/ }),
  ).toHaveCount(0);

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
  await page.getByRole("button", { name: "Upcoming" }).click();
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
  await expect(page.getByRole("heading", { name: "Upcoming" })).toBeVisible();
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

  await openTaskSection(page, "Time");
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
  await openTaskSection(page, "Time");
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
  await openTaskSection(page, "Time");
  await page.getByLabel("Timer description").fill("Research");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  await page.getByText("Parallel build", { exact: true }).click();
  await openTaskSection(page, "Time");
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
  await expect(page.getByLabel("Status")).toHaveAttribute("data-value", "open");
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
  await chooseDate(page, "Due date", today);
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
    groupBy:
      property: status
      direction: ASC
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

  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: /Saved views/ }).click();
  await expect(page.getByRole("heading", { name: "Views" })).toBeVisible();
  await expect(page.getByText("Work board", { exact: true })).toBeVisible();
  await expect(page.getByText("Task details", { exact: true })).toBeVisible();
  await expect(page.getByText("Dates", { exact: true })).toBeVisible();

  await page
    .getByRole("button", { name: "Add Work board to navigation" })
    .click();
  await page
    .locator(".view-document")
    .filter({ has: page.getByRole("heading", { name: "work" }) })
    .getByRole("button", { name: "Work board", exact: true })
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
  const inProgressColumn = page.getByLabel("In progress column");
  await page.getByRole("button", { name: "Add task to In progress" }).click();
  const boardCapture = page.getByLabel("New task title");
  await expect(boardCapture).toHaveAttribute(
    "placeholder",
    "Add to In progress",
  );
  await boardCapture.fill("Column capture");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    inProgressColumn.getByText("Column capture", { exact: true }),
  ).toBeVisible();
  const movePlan = page.getByRole("button", {
    name: "Move Plan saved views. Drag, or use left and right arrow keys.",
  });
  await dragKanbanHandle(
    page,
    movePlan,
    inProgressColumn,
    testInfo.project.name === "mobile",
  );
  await expect(
    inProgressColumn.getByText("Plan saved views", { exact: true }),
  ).toBeVisible();
  await expect(
    inProgressColumn
      .locator(".kanban-card")
      .filter({ hasText: "Plan saved views" }),
  ).toHaveAttribute("aria-busy", "false");
  await expect(
    page.getByRole("button", {
      name: testInfo.project.name === "mobile" ? "More views" : "Work board",
      exact: true,
    }),
  ).toHaveAttribute("aria-current", "page");

  await page.reload();
  await expect(page.getByLabel("Work board board")).toBeVisible();
  await expect(
    page
      .getByLabel("In progress column")
      .getByText("Plan saved views", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: testInfo.project.name === "mobile" ? "More views" : "Work board",
      exact: true,
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: /Saved views/ }).click();
  await page.getByText("Task details", { exact: true }).click();
  await expect(
    page.locator(".saved-view-groups").getByRole("heading", {
      name: "in-progress",
    }),
  ).toBeVisible();
  await expect(
    page.locator(".saved-view-groups").getByRole("heading", { name: "done" }),
  ).toBeVisible();
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
  await expect(page.locator(".full-calendar-view .fc-daygrid")).toBeVisible();
  await expect(
    page
      .locator(".full-calendar-inspector .task-row-title")
      .getByText("Plan saved views", { exact: true }),
  ).toBeVisible();
  const calendarCapture = page.getByLabel("New task title");
  await expect(calendarCapture).toHaveAttribute("placeholder", "Add to Dates");
  const captureBounds = await page.locator(".capture-composer").boundingBox();
  const calendarBounds = await page
    .locator(".full-calendar-view")
    .boundingBox();
  expect(captureBounds).not.toBeNull();
  expect(calendarBounds).not.toBeNull();
  expect(
    calendarBounds!.y - (captureBounds!.y + captureBounds!.height),
  ).toBeGreaterThanOrEqual(18);
  await calendarCapture.fill("Created on the calendar");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page
      .locator(".full-calendar-inspector .task-row-title")
      .getByText("Created on the calendar", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".full-calendar-inspector")
      .getByText("Due", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(page.getByText("Progress", { exact: true })).toHaveCount(0);
  if (testInfo.project.name === "desktop") {
    const nextDay = new Date(`${today}T12:00:00`);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayValue = [
      nextDay.getFullYear(),
      String(nextDay.getMonth() + 1).padStart(2, "0"),
      String(nextDay.getDate()).padStart(2, "0"),
    ].join("-");
    const destination = page.locator(
      `.fc-daygrid-day[data-date="${nextDayValue}"]`,
    );
    await dragCalendarEvent(
      page,
      page.locator(".fc-daygrid-event").filter({ hasText: "Plan saved views" }),
      destination,
    );
    await expect(
      destination.getByText("Plan saved views", { exact: true }),
    ).toBeVisible();
    await destination.getByText("Plan saved views", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Due date", exact: true }),
    ).toHaveAttribute("data-value", nextDayValue);
    await page.getByRole("button", { name: "Back", exact: true }).click();

    await expect(
      page.locator(".fc-daygrid-event").getByText("Plan saved views"),
    ).toBeVisible();
    const calendar = await page.locator(".full-calendar-surface").boundingBox();
    const agenda = await page.locator(".full-calendar-inspector").boundingBox();
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

test("orders several navigation views and keeps the rest behind the mobile overflow", async ({
  page,
}, testInfo) => {
  await page.getByLabel("New task title").fill("Navigation task");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const tasknotes = await root.getDirectoryHandle("TaskNotes", {
      create: true,
    });
    const views = await tasknotes.getDirectoryHandle("views", {
      create: true,
    });
    const file = await views.getFileHandle("navigation.base", {
      create: true,
    });
    const writable = await file.createWritable();
    await writable.write(`views:
  - type: tasknotesTaskList
    name: Focus
    order: [status]
  - type: tasknotesTaskList
    name: Later
    order: [due]
`);
    await writable.close();
  });

  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: /Saved views/ }).click();
  await expect(
    page.getByRole("heading", { name: "tasknotes-app", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "navigation", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add Focus to navigation" }).click();
  await page.getByRole("button", { name: "Add Later to navigation" }).click();
  await page.getByRole("button", { name: "Move Focus earlier" }).click();
  await page.getByRole("button", { name: "Move Focus earlier" }).click();
  await page.getByRole("button", { name: "Move Focus earlier" }).click();
  await page.getByRole("button", { name: "Move Focus earlier" }).click();

  const ordered = page.locator(".navigation-view-order li");
  await expect(ordered).toHaveCount(6);
  await expect(ordered.nth(0)).toContainText("Focus");
  await expect(ordered.nth(1)).toContainText("Today");
  await expect(ordered.nth(2)).toContainText("Upcoming");
  await expect(ordered.nth(3)).toContainText("Calendar");
  await expect(ordered.nth(4)).toContainText("Projects");
  await expect(ordered.nth(5)).toContainText("Later");

  if (testInfo.project.name === "mobile") {
    const navigation = page.locator(".bottom-navigation");
    await expect(
      navigation.getByRole("button", { name: "More views", exact: true }),
    ).toBeVisible();
    await expect(
      navigation.getByRole("button", { name: "Later", exact: true }),
    ).toHaveCount(0);
  } else {
    await expect(
      page
        .locator(".navigation-rail")
        .getByRole("button", { name: "Later", exact: true }),
    ).toBeVisible();
  }

  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Focus" })).toBeVisible();
  await expect(
    page.getByText("Navigation task", { exact: true }),
  ).toBeVisible();
});

test("keeps a task recoverable when a view filter cannot be inverted", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const tasknotes = await root.getDirectoryHandle("TaskNotes", {
      create: true,
    });
    const views = await tasknotes.getDirectoryHandle("views", {
      create: true,
    });
    const file = await views.getFileHandle("future.base", { create: true });
    const writable = await file.createWritable();
    await writable.write(`views:
  - type: tasknotesTaskList
    name: Future
    filters: due > today()
`);
    await writable.close();
  });

  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: /Saved views/ }).click();
  await page.getByText("Future", { exact: true }).click();
  await page.getByLabel("New task title").fill("Outside the future filter");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await expect(
    page.getByText(/Task created, but this view does not show it/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open task" }).click();
  await expect(page.getByLabel("Task title", { exact: true })).toHaveValue(
    "Outside the future filter",
  );
});

test("creates, edits, executes, and deletes a saved view", async ({ page }) => {
  await page.getByLabel("New task title").fill("Build the view editor");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await openViewsCatalog(page);
  await page.getByRole("button", { name: "Create view" }).click();
  await expect(
    page.getByRole("heading", { name: "Create a view" }),
  ).toBeVisible();

  await page.getByLabel("Name").fill("Open work");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByRole("button", { name: "Expression", exact: true }).click();
  await page.getByLabel("Filter expression").fill("status == (");
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Builder", exact: true }).click();
  await page.getByLabel("Filter property").fill("status");
  await chooseOption(page, "Filter condition", "is");
  await chooseOption(page, "Filter value", "Open");
  await page.getByLabel("Board column").fill("status");
  await page.getByLabel("Property to display").fill("priority");
  await page.getByRole("button", { name: "Add", exact: true }).last().click();
  const creationDefaults = page.locator("details.view-create-defaults");
  await creationDefaults.locator("summary").click();
  await expect(creationDefaults).toHaveAttribute("open", "");
  await chooseOption(creationDefaults, "Priority", "High");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByText("Open work", { exact: true })).toBeVisible();
  await page.getByText("Open work", { exact: true }).click();
  await expect(page.getByLabel("Open work board")).toBeVisible();
  await expect(
    page.getByText("Build the view editor", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("New task title").fill("View capture sample");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText("View capture sample", { exact: true }),
  ).toBeVisible();
  await page.getByText("View capture sample", { exact: true }).click();
  const organize = page.locator("details.task-form-section").filter({
    has: page.locator("summary strong", { hasText: "Organize" }),
  });
  await organize.locator("summary").click();
  await expect(organize).toHaveAttribute("open", "");
  await expect(
    organize.getByRole("button", { name: "High", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Back", exact: true }).click();

  await page.getByRole("button", { name: "Edit Open work" }).click();
  await expect(
    page.getByRole("region", { name: "View settings" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByLabel("Open work board")).toHaveCount(0);
  await expect(
    page.getByText("Build the view editor", { exact: true }),
  ).toBeVisible();

  await page
    .locator("#main-content")
    .getByRole("button", { name: "Views", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Views" })).toBeVisible();
  await page.getByRole("button", { name: "Edit Open work" }).click();
  await expect(page.getByRole("heading", { name: "Edit view" })).toBeVisible();
  await page.getByLabel("Name").fill("Focused work");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Focused work", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit Focused work" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete view" }).click();
  await expect(page.getByText("Focused work", { exact: true })).toHaveCount(0);
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
  await expect(
    page.getByRole("heading", { name: "Today", level: 1 }),
  ).toBeVisible();
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

async function openTaskSection(
  page: import("@playwright/test").Page,
  name: string,
) {
  await page
    .locator("details.task-form-section > summary")
    .filter({ hasText: new RegExp(`^${name}`) })
    .click();
}
