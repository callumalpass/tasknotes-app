import { expect, test } from "@playwright/test";
import { buildTaskNotesMdbaseResources } from "@tasknotes/model/mdbase";

import type { Locator, Page } from "@playwright/test";

const templatedType = buildTaskNotesMdbaseResources({
  templating: {
    enabled: true,
    templatePath: "Templates/Task.md",
  },
}).typeDocument;

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

async function dragManualOrderHandle(
  page: Page,
  handle: Locator,
  destination: Locator,
  touch: boolean,
) {
  await handle.scrollIntoViewIfNeeded();
  await destination.scrollIntoViewIfNeeded();
  const sourceBox = await handle.boundingBox();
  const destinationBox = await destination.boundingBox();
  if (!sourceBox || !destinationBox)
    throw new Error("Manual order elements are not laid out");
  const start = {
    x: sourceBox.x + sourceBox.width / 2,
    y: sourceBox.y + sourceBox.height / 2,
  };
  const end = {
    x: destinationBox.x + destinationBox.width / 2,
    y: destinationBox.y + destinationBox.height * 0.76,
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
    for (let step = 1; step <= 8; step += 1)
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
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
}

async function dragCalendarEvent(event: Locator, destinationDay: Locator) {
  await event.scrollIntoViewIfNeeded();
  const destination = await destinationDay.boundingBox();
  if (!destination) throw new Error("Calendar destination is not laid out");
  await event.dragTo(destinationDay, {
    targetPosition: {
      x: destination.width / 2,
      y: Math.min(36, destination.height / 2),
    },
  });
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

async function localTaskTypeDocument(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const tasknotes = await root.getDirectoryHandle("TaskNotes");
    const types = await tasknotes.getDirectoryHandle("_types");
    const task = await types.getFileHandle("task.md");
    return (await task.getFile()).text();
  });
}

async function localDefaultViewDocument(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const tasknotes = await root.getDirectoryHandle("TaskNotes");
    const views = await tasknotes.getDirectoryHandle("views");
    const view = await views.getFileHandle("tasknotes-app.base");
    return (await view.getFile()).text();
  });
}

async function openViewsCatalog(page: Page): Promise<void> {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: /Saved views/ }).click();
}

async function openSettingsSection(
  scope: Page | Locator,
  name: string,
): Promise<Locator> {
  const section = scope
    .getByRole("heading", { name, exact: true })
    .locator("..")
    .locator("..");
  if ((await section.getAttribute("open")) === null)
    await section.locator(":scope > summary").click();
  return section;
}

async function openViewEditorSection(
  scope: Locator,
  name: string,
): Promise<Locator> {
  const section = scope
    .getByRole("heading", { name, exact: true })
    .locator("..")
    .locator("..")
    .locator("..");
  if ((await section.getAttribute("open")) === null)
    await section.locator("summary").click();
  return section;
}

async function expectTouchTargets(scope: Locator): Promise<void> {
  const undersized = await scope
    .locator(
      "button, summary, input:not([type='checkbox']):not([type='radio']), [role='combobox']",
    )
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const node = element as HTMLElement;
        const style = getComputedStyle(node);
        const bounds = node.getBoundingClientRect();
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          bounds.width === 0 ||
          bounds.height === 0
        )
          return [];
        if (bounds.width >= 43.5 && bounds.height >= 43.5) return [];
        return [
          {
            name:
              node.getAttribute("aria-label") ??
              node.textContent?.trim().slice(0, 60) ??
              node.tagName,
            width: Math.round(bounds.width * 10) / 10,
            height: Math.round(bounds.height * 10) / 10,
          },
        ];
      }),
    );
  expect(undersized).toEqual([]);
}

async function openNavigationView(page: Page, name: string): Promise<void> {
  const navigation = page.locator(".bottom-navigation, .navigation-rail");
  const direct = navigation.getByRole("button", { name, exact: true });
  if (await direct.count()) {
    await direct.click();
    return;
  }
  await navigation.getByRole("button", { name: "Views", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

async function openSearch(page: Page): Promise<void> {
  const navigation = page.locator(".bottom-navigation, .navigation-rail");
  await navigation.getByRole("button", { name: "Views", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Search tasks", exact: true })
    .click();
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
  await expect(page.getByRole("note")).toContainText(
    "Notifications are not available",
  );
  await page.getByRole("button", { name: "Use this browser" }).click();
  await expect(
    page.getByRole("heading", { name: "Today", level: 1 }),
  ).toBeVisible();
});

test("manually reorders starter-view tasks with pointer and keyboard", async ({
  page,
}, testInfo) => {
  for (const title of ["Manual first", "Manual second", "Manual third"]) {
    await page.getByLabel("New task title").fill(title);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  }

  const list = page.locator(".task-list-view");
  const rows = list.locator(".manual-order-row");
  await expect(rows).toHaveCount(3);
  if (testInfo.project.name === "mobile") await expectTouchTargets(list);

  const firstHandle = page.getByRole("button", {
    name: "Reorder Manual first. Drag, or use up and down arrow keys.",
  });
  const thirdRow = rows.filter({
    has: page.getByText("Manual third", { exact: true }),
  });
  await dragManualOrderHandle(
    page,
    firstHandle,
    thirdRow,
    testInfo.project.name === "mobile",
  );
  await expect
    .poll(() => rows.locator(".task-row-title").allTextContents())
    .toEqual(["Manual second", "Manual third", "Manual first"]);

  const movedHandle = page.getByRole("button", {
    name: "Reorder Manual first. Drag, or use up and down arrow keys.",
  });
  await expect(movedHandle).toBeEnabled();
  await movedHandle.press("ArrowUp");
  await expect
    .poll(() => rows.locator(".task-row-title").allTextContents())
    .toEqual(["Manual second", "Manual first", "Manual third"]);
  await expect(
    page.getByRole("button", {
      name: "Reorder Manual first. Drag, or use up and down arrow keys.",
    }),
  ).toBeEnabled();

  const documents = await localTaskDocuments(page);
  const ranks = documents.flatMap(
    (source) =>
      source.match(/tasknotes_manual_order:\s*(tn[a-z]{10})/)?.[1] ?? [],
  );
  expect(new Set(ranks).size).toBe(3);
  const defaultViews = await localDefaultViewDocument(page);
  expect(
    defaultViews.match(
      /property: note\.tasknotes_manual_order\s+direction: DESC/g,
    ),
  ).toHaveLength(5);

  await testInfo.attach("manual-order.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.getByRole("button", { name: "Edit Today" }).click();
  const editor = page.getByRole("dialog", { name: "Edit view" });
  await openViewEditorSection(editor, "Arrange");
  await expect(
    editor.getByText(
      "Manual order is active. Drag handles will appear on tasks.",
    ),
  ).toBeVisible();
  await expect(
    editor.getByRole("combobox", { name: "Sort property 1" }),
  ).toHaveValue("note.tasknotes_manual_order");
  await testInfo.attach("manual-order-editor.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await editor.getByRole("button", { name: "Close view editor" }).click();
  await page.reload();
  await expect
    .poll(() =>
      page
        .locator(".task-list-view .manual-order-row .task-row-title")
        .allTextContents(),
    )
    .toEqual(["Manual second", "Manual first", "Manual third"]);
});

test("surfaces a quiet warning while a durable local mutation is pending", async ({
  page,
}, testInfo) => {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByText(/waiting to be written to Markdown/)).toHaveCount(
    0,
  );

  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("tasknotes-index-v2");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("mutations", "readwrite");
          transaction.objectStore("mutations").put({
            taskId: "pending-local-e2e",
            operationId: crypto.randomUUID(),
            kind: "delete",
            path: "../unavailable.md",
            enqueuedAt: Date.now(),
            attempts: 0,
          });
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "More", level: 1 }),
  ).toBeVisible();

  const warning = page.getByText(/waiting to be written to Markdown/);
  await expect(warning).toContainText(
    "1 local change is waiting to be written to Markdown.",
  );
  await warning.evaluate((element) =>
    element.scrollIntoView({ block: "center" }),
  );
  await testInfo.attach("pending-local-mutation.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("rehydrates older cached task shapes without a render failure", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) =>
    pageErrors.push(error.stack ?? error.message),
  );
  await page.getByLabel("New task title").fill("Legacy cached task");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText("Legacy cached task", { exact: true }),
  ).toBeVisible();

  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("tasknotes-index-v2");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("tasks", "readwrite");
          const store = transaction.objectStore("tasks");
          const cursor = store.openCursor();
          cursor.onerror = () => reject(cursor.error);
          cursor.onsuccess = () => {
            const current = cursor.result;
            if (!current) return;
            const legacy = current.value;
            delete legacy.blockedBy;
            delete legacy.reminders;
            delete legacy.timeEntries;
            delete legacy.customProperties;
            current.update(legacy);
          };
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
  );
  await page.reload();
  await page.getByText("Legacy cached task", { exact: true }).click();

  await expect(page.getByLabel("Task title", { exact: true })).toHaveValue(
    "Legacy cached task",
  );
  await expect(
    page.getByRole("heading", { name: "TaskNotes needs to restart." }),
  ).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("suggests capture values from the collection contract", async ({
  page,
}, testInfo) => {
  const capture = page.getByLabel("New task title");
  await capture.fill("Seed context @home");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Seed context", { exact: true })).toBeVisible();

  const startedAt = await page.evaluate(() => performance.now());
  await capture.fill("Call plumber @ho");
  const suggestion = page.getByRole("option", { name: "home", exact: true });
  await expect(suggestion).toBeVisible();
  const suggestionLatencyMs = await page.evaluate(
    (start) => performance.now() - start,
    startedAt,
  );
  await testInfo.attach("capture-suggestion-profile.json", {
    body: JSON.stringify({ suggestionLatencyMs }, null, 2),
    contentType: "application/json",
  });
  expect(suggestionLatencyMs).toBeLessThan(750);

  await capture.press("Enter");
  await expect(capture).toHaveValue("Call plumber @home ");
  await capture.press("Enter");
  await expect(page.getByText("Call plumber", { exact: true })).toBeVisible();
});

test("organizes the Today list into declarative day sections", async ({
  page,
}, testInfo) => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const dateValue = (date: Date) =>
    [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");

  await page.getByLabel("New task title").fill("Anytime hierarchy task");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText("Anytime hierarchy task", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("New task title").fill("Current hierarchy task");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText("Current hierarchy task", { exact: true }),
  ).toBeVisible();
  await page.getByText("Current hierarchy task", { exact: true }).click();
  await chooseDate(page, "Scheduled date", dateValue(today));
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  await page.getByLabel("New task title").fill("Late hierarchy task");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText("Late hierarchy task", { exact: true }),
  ).toBeVisible();
  await page.getByText("Late hierarchy task", { exact: true }).click();
  await chooseDate(page, "Due date", dateValue(yesterday));
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  const headings = page.locator(".day-task-sections .section-heading h2");
  await expect(headings).toHaveText(["Overdue", "Today", "Anytime"]);
  await expect(
    page
      .locator(".task-section.is-overdue")
      .getByText("Late hierarchy task", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".task-section.is-today")
      .getByText("Current hierarchy task", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".task-section.is-anytime")
      .getByText("Anytime hierarchy task", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "More", exact: true }).click();
  const startedAt = await page.evaluate(() => performance.now());
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(headings).toHaveCount(3);
  const sectionRenderMs = await page.evaluate(
    (start) => performance.now() - start,
    startedAt,
  );
  await testInfo.attach("today-sections-profile.json", {
    body: JSON.stringify({ sectionRenderMs }, null, 2),
    contentType: "application/json",
  });
  expect(sectionRenderMs).toBeLessThan(750);
});

test("captures into the collection from anywhere", async ({
  page,
}, testInfo) => {
  const inlineCapture = page.getByLabel("New task title");
  await inlineCapture.focus();
  expect(
    await inlineCapture.evaluate(
      (element) => getComputedStyle(element).outlineStyle,
    ),
  ).toBe("none");
  await inlineCapture.blur();

  await page.getByRole("button", { name: "More", exact: true }).click();
  const trigger = page.getByRole("button", { name: "New task", exact: true });
  const triggerBox = await trigger.boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(triggerBox!.width).toBeGreaterThanOrEqual(44);
  expect(triggerBox!.height).toBeGreaterThanOrEqual(44);

  const openedAt = await page.evaluate(() => performance.now());
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await expect(dialog).toBeVisible();
  const openLatencyMs = await page.evaluate(
    (start) => performance.now() - start,
    openedAt,
  );
  await expect(dialog.getByLabel("New task title")).toBeFocused();
  expect(
    await dialog
      .getByLabel("New task title")
      .evaluate((element) => getComputedStyle(element).outlineStyle),
  ).toBe("none");
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  const duplicateIds = await page.evaluate(() => {
    const ids = [...document.querySelectorAll<HTMLElement>("[id]")].map(
      (element) => element.id,
    );
    return ids.filter((id, index) => ids.indexOf(id) !== index);
  });
  expect(duplicateIds).toEqual([]);

  if (testInfo.project.name === "mobile") {
    const [box, viewport] = await Promise.all([
      dialog.boundingBox(),
      Promise.resolve(page.viewportSize()),
    ]);
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(viewport!.width - 1);
    expect(
      Math.abs(box!.y + box!.height - viewport!.height),
    ).toBeLessThanOrEqual(1);
  }

  await dialog.getByLabel("New task title").fill("Captured from More");
  const createdAt = await page.evaluate(() => performance.now());
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const createLatencyMs = await page.evaluate(
    (start) => performance.now() - start,
    createdAt,
  );
  await testInfo.attach("global-capture-profile.json", {
    body: JSON.stringify({ openLatencyMs, createLatencyMs }, null, 2),
    contentType: "application/json",
  });
  expect(openLatencyMs).toBeLessThan(500);
  expect(createLatencyMs).toBeLessThan(750);

  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(
    page.getByText("Captured from More", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+n");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
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

test("edits task model settings in the portable type contract", async ({
  page,
}, testInfo) => {
  const settingsStartedAt = await page.evaluate(() => performance.now());
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByRole("heading", { name: "More" })).toBeVisible();
  const settingsRenderMs = await page.evaluate(
    (start) => performance.now() - start,
    settingsStartedAt,
  );
  expect(settingsRenderMs).toBeLessThan(500);
  await expect(
    page.getByText(
      "Open another local collection, or adopt this complete collection into hosted mdbase and move authority there.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Change collection" }),
  ).toBeVisible();
  const disclosureStartedAt = await page.evaluate(() => performance.now());
  await openSettingsSection(page, "Advanced");
  const disclosureOpenMs = await page.evaluate(
    (start) => performance.now() - start,
    disclosureStartedAt,
  );
  expect(disclosureOpenMs).toBeLessThan(500);
  if (testInfo.project.name === "mobile")
    await expectTouchTargets(page.locator(".settings-screen"));
  await chooseOption(page, "Default status", "In progress");
  await chooseOption(page, "Default priority", "High");
  await chooseOption(page, "Record links", "Markdown links");
  await page
    .getByLabel("Future occurrence horizon amount", { exact: true })
    .fill("30");
  await page.getByLabel("Stop a running timer when its task completes").check();

  const startedAt = await page.evaluate(() => performance.now());
  await page
    .getByRole("button", { name: "Save task settings", exact: true })
    .click();
  await expect(page.getByText("Saved to the type contract.")).toBeVisible();
  const saveLatencyMs = await page.evaluate(
    (start) => performance.now() - start,
    startedAt,
  );
  await testInfo.attach("task-model-settings-profile.json", {
    body: JSON.stringify(
      { settingsRenderMs, disclosureOpenMs, saveLatencyMs },
      null,
      2,
    ),
    contentType: "application/json",
  });
  expect(saveLatencyMs).toBeLessThan(750);

  const typeSource = await localTaskTypeDocument(page);
  expect(typeSource).toContain("default: in-progress");
  expect(typeSource).toContain("default: high");
  expect(typeSource).toContain("write_format: markdown");
  expect(typeSource).toContain("future_horizon: P30D");
  expect(typeSource).toContain("auto_stop_on_complete: true");

  await page.reload();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await openSettingsSection(page, "Advanced");
  await expect(
    page.getByRole("combobox", { name: "Default status" }),
  ).toHaveAttribute("data-value", "in-progress");
  await expect(
    page.getByRole("combobox", { name: "Default priority" }),
  ).toHaveAttribute("data-value", "high");

  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByLabel("New task title").fill("Contract default task");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("Contract default task", { exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Status" })).toHaveAttribute(
    "data-value",
    "in-progress",
  );
  await page.getByText("Organize", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "High", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("auto-archives from a contract status event without polling", async ({
  page,
}, testInfo) => {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await openSettingsSection(page, "Advanced");
  const doneAutomation = page
    .locator(".status-automation-row")
    .filter({ hasText: "Done" });
  await doneAutomation.getByRole("checkbox").check();
  await doneAutomation.getByRole("spinbutton").fill("0");
  await page
    .getByRole("button", { name: "Save task settings", exact: true })
    .click();
  await expect(page.getByText("Saved to the type contract.")).toBeVisible();

  const typeSource = await localTaskTypeDocument(page);
  expect(typeSource).toContain("auto_archive: true");
  expect(typeSource).toContain("auto_archive_delay_minutes: 0");

  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByLabel("New task title").fill("File completed report");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const startedAt = await page.evaluate(() => performance.now());
  await page
    .getByRole("button", { name: "Complete File completed report" })
    .click();
  await expect(
    page.getByText("File completed report", { exact: true }),
  ).toHaveCount(0);
  const archiveLatencyMs = await page.evaluate(
    (start) => performance.now() - start,
    startedAt,
  );
  await testInfo.attach("auto-archive-profile.json", {
    body: JSON.stringify({ archiveLatencyMs }, null, 2),
    contentType: "application/json",
  });
  expect(archiveLatencyMs).toBeLessThan(750);

  await openNavigationView(page, "Archive");
  await expect(
    page.getByText("File completed report", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("File completed report", { exact: true }),
  ).toBeVisible();
});

test("edits planning fields, recurrence, reminders, and upcoming tasks", async ({
  page,
}, testInfo) => {
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
  await expect(
    page.getByRole("button", { name: "Connect mdbase" }),
  ).toHaveCount(0);
  await chooseOption(page, "Repeat", "Weekly");
  await page.getByLabel("Repeat interval").fill("2");
  await page.getByRole("button", { name: "Monday" }).click();
  await chooseOption(page, "Ends", "After a number of times");
  await page.getByRole("spinbutton", { name: "Occurrences" }).fill("6");
  await expect(page.getByText(/Every 2 weeks/)).toBeVisible();
  if (testInfo.project.name === "mobile")
    await expectTouchTargets(page.locator(".recurrence-field"));
  await testInfo.attach("recurrence-builder.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page
    .getByRole("button", { name: "Add 15 minutes before scheduled" })
    .click();
  const firstReminder = page.getByRole("region", { name: "Reminder 1" });
  await firstReminder.getByLabel("Amount").fill("30");
  await page.getByRole("button", { name: "Add reminder" }).click();
  const secondReminder = page.getByRole("region", { name: "Reminder 2" });
  await chooseOption(secondReminder, "Type", "Fixed date and time");
  await chooseDate(page, "Reminder date", tomorrowValue);
  await chooseTime(page, "Reminder time", "09:00");
  await expect(page.getByRole("region", { name: /Reminder \d/ })).toHaveCount(
    2,
  );
  await expect
    .poll(async () => {
      const source = (await localTaskDocuments(page)).find((document) =>
        document.includes("Prepare weekly review"),
      );
      return {
        absolute: source?.includes("type: absolute") ?? false,
        relative: source?.includes("type: relative") ?? false,
        recurrence:
          source?.includes("FREQ=WEEKLY") &&
          source.includes("INTERVAL=2") &&
          source.includes("COUNT=6"),
      };
    })
    .toEqual({ absolute: true, relative: true, recurrence: true });
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByText("Repeat and reminders", { exact: true }).click();
  await expect(page.getByRole("region", { name: /Reminder \d/ })).toHaveCount(
    2,
  );
  await expect(
    page.getByRole("region", { name: "Reminder 1" }).getByLabel("Amount"),
  ).toHaveValue("30");
  await page.getByRole("button", { name: "Back", exact: true }).click();

  await page.getByRole("button", { name: "Upcoming" }).click();
  await expect(
    page.locator(".full-calendar-view.is-agenda .fc-list"),
  ).toBeVisible();
  const upcomingTask = page
    .getByText("Prepare weekly review", { exact: true })
    .first();
  for (
    let attempt = 0;
    attempt < 2 && !(await upcomingTask.isVisible());
    attempt += 1
  ) {
    await page.getByRole("button", { name: "Next period" }).click();
  }
  await expect(upcomingTask).toBeVisible();
  await openNavigationView(page, "Calendar");
  await expect(page.locator(".full-calendar-view .fc-daygrid")).toBeVisible();
  await page.getByRole("button", { name: "Upcoming", exact: true }).click();
  await expect(
    page.locator(".full-calendar-view.is-agenda .fc-list"),
  ).toBeVisible();
  await openSearch(page);
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

  await openSearch(page);
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
  await openSearch(page);
  await page.getByLabel("Search tasks").fill("web-native");
  await expect(
    page.getByText("Review web-native storage", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reopen Review web-native storage" }),
  ).toBeVisible();
});

test("writes and safely previews Markdown task notes on demand", async ({
  page,
}, testInfo) => {
  await page.getByLabel("New task title").fill("Document launch checks");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("Document launch checks", { exact: true }).click();
  const notes = page.getByLabel("Notes");
  await notes.fill(`## Launch checklist

- [x] Contract checked
- [ ] Publish build

| Surface | State |
| --- | --- |
| Mobile | Ready |

[Reference](https://example.com/docs)

<script>window.markdownInjected = true</script>`);
  await expect
    .poll(async () =>
      (await localTaskDocuments(page)).some((source) =>
        source.includes("## Launch checklist"),
      ),
    )
    .toBe(true);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  const previewButton = page.getByRole("button", {
    name: "Preview",
    exact: true,
  });
  const buttonBox = await previewButton.boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(buttonBox!.height).toBeGreaterThanOrEqual(44);
  const loadedBefore = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .some((entry) => entry.name.includes("markdown-preview")),
  );
  expect(loadedBefore).toBe(false);

  const previewTimingAttribute = "data-markdown-preview-latency-ms";
  await page.evaluate((attribute) => {
    document.body.removeAttribute(attribute);
    const startedAt = performance.now();
    const observer = new MutationObserver(() => {
      if (!document.querySelector(".markdown-preview")) return;
      document.body.setAttribute(
        attribute,
        String(performance.now() - startedAt),
      );
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }, previewTimingAttribute);
  await previewButton.click();
  const preview = page.locator(".markdown-preview");
  await expect(
    preview.getByRole("heading", { name: "Launch checklist" }),
  ).toBeVisible();
  const previewLatencyMs = Number(
    await page.locator("body").getAttribute(previewTimingAttribute),
  );
  await expect(preview.getByRole("table")).toBeVisible();
  await expect(preview.getByRole("checkbox")).toHaveCount(2);
  await expect(
    preview.getByRole("link", { name: "Reference" }),
  ).toHaveAttribute("rel", "noreferrer");
  await expect(preview.locator("script")).toHaveCount(0);
  expect(await page.evaluate(() => "markdownInjected" in window)).toBe(false);
  const loadedAfter = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .some((entry) => entry.name.includes("markdown-preview")),
  );
  expect(loadedAfter).toBe(true);
  await testInfo.attach("markdown-preview-profile.json", {
    body: JSON.stringify({ previewLatencyMs }, null, 2),
    contentType: "application/json",
  });
  expect(previewLatencyMs).toBeLessThan(750);

  await page.reload();
  await expect(page.getByLabel("Notes")).toHaveValue(/Launch checklist/);
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
  const taskOptions = page.getByRole("button", { name: "More task actions" });
  await taskOptions.click();
  await expect(
    page.getByRole("menuitem", { name: "Archive task" }),
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("menuitem", { name: "Delete task" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(taskOptions).toBeFocused();
  await taskOptions.click();
  await page.getByRole("menuitem", { name: "Archive task" }).click();
  await expect(
    page.getByText("Keep archived history", { exact: true }),
  ).toHaveCount(0);

  await openNavigationView(page, "Archive");
  await expect(page.getByRole("heading", { name: "Archive" })).toBeVisible();
  await page.getByText("Keep archived history", { exact: true }).click();
  await page.getByRole("button", { name: "More task actions" }).click();
  await page.getByRole("menuitem", { name: "Restore task" }).click();
  await expect(page.getByText("Nothing here")).toBeVisible();
  const restoredDocuments = await localTaskDocuments(page);
  expect(restoredDocuments).toHaveLength(1);
  expect(restoredDocuments[0]).not.toMatch(/^\s*-\s+archived\s*$/m);

  await page.reload();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(
    page.getByText("Keep archived history", { exact: true }),
  ).toBeVisible();
});

test("keeps destructive task actions quiet and safely confirmed", async ({
  page,
}) => {
  await page.getByLabel("New task title").fill("Delete with confirmation");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("Delete with confirmation", { exact: true }).click();

  const taskOptions = page.getByRole("button", { name: "More task actions" });
  await taskOptions.click();
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Delete this task?",
  });
  await expect(confirmation).toBeVisible();
  await expect(
    confirmation.getByRole("button", { name: "Keep task" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(taskOptions).toBeFocused();

  await taskOptions.click();
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await confirmation.getByRole("button", { name: "Delete task" }).click();
  await expect(page.getByText("Delete with confirmation")).toHaveCount(0);
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

test("completes project links and groups the ordinary Projects view", async ({
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

  await openNavigationView(page, "Projects");

  await expect(
    page.getByRole("heading", { name: /Projects\/mobile/, level: 2 }),
  ).toBeVisible();
  await expect(
    page.getByText("Prepare mobile release", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("New task title")).toHaveCount(0);

  const documents = await localTaskDocuments(page);
  expect(documents).toHaveLength(1);
  expect(
    documents.some((source) =>
      /projects:\s*\n\s*-\s+['"]?\[\[Projects\/mobile\]\]['"]?/.test(source),
    ),
  ).toBe(true);
});

test("persists dependencies and derives blocking tasks and subtasks", async ({
  page,
}, testInfo) => {
  for (const title of [
    "Dependency parent",
    "Dependency blocker",
    "Dependency child",
  ]) {
    await page.getByLabel("New task title").fill(title);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  }

  await page.getByText("Dependency parent", { exact: true }).click();
  await page.getByText("Organize", { exact: true }).click();
  await page.getByLabel("Blocked by").fill("blocker");
  await page
    .getByRole("option", { name: /Dependency blocker.*tasks\// })
    .click();
  await chooseOption(page, "Relationship", "Start to start");
  await page.getByLabel("Gap amount", { exact: true }).fill("2");
  await expect
    .poll(async () => {
      const source = (await localTaskDocuments(page)).find((document) =>
        document.includes("Dependency parent"),
      );
      return (
        source?.includes("blockedBy:") &&
        source.includes("reltype: STARTTOSTART") &&
        source.includes("gap: P2D")
      );
    })
    .toBe(true);
  await page.getByRole("button", { name: "Back", exact: true }).click();

  await page.getByText("Dependency child", { exact: true }).click();
  await page.getByText("Organize", { exact: true }).click();
  await page.getByLabel("Projects").fill("parent");
  await page
    .getByRole("option", { name: /Dependency parent.*tasks\// })
    .click();
  await page.getByLabel("Blocked by").fill("parent");
  await page
    .getByRole("option", { name: /Dependency parent.*tasks\// })
    .click();
  await expect
    .poll(async () => {
      const source = (await localTaskDocuments(page)).find((document) =>
        document.includes("Dependency child"),
      );
      return source?.includes("blockedBy:") && source.includes("projects:");
    })
    .toBe(true);
  await page.getByRole("button", { name: "Back", exact: true }).click();

  const startedAt = await page.evaluate(() => performance.now());
  await page.getByText("Dependency parent", { exact: true }).click();
  await page.getByText("Organize", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Related work" }),
  ).toBeVisible();
  const relationshipRenderMs = await page.evaluate(
    (start) => performance.now() - start,
    startedAt,
  );
  await testInfo.attach("dependency-relationship-profile.json", {
    body: JSON.stringify({ relationshipRenderMs }, null, 2),
    contentType: "application/json",
  });
  expect(relationshipRenderMs).toBeLessThan(1_000);
  await expect(page.getByText("Dependency child", { exact: true })).toHaveCount(
    2,
  );

  await page.reload();
  await expect(page.getByLabel("Task title", { exact: true })).toHaveValue(
    "Dependency parent",
  );
  await page.getByText("Organize", { exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Relationship" }),
  ).toHaveAttribute("data-value", "STARTTOSTART");
  await expect(page.getByLabel("Gap amount", { exact: true })).toHaveValue("2");
  await expect(
    page.getByRole("button", { name: "Remove Dependency blocker" }),
  ).toBeVisible();
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
    sort:
      - column: note.tasknotes_manual_order
        direction: DESC
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
    name: "Move Plan saved views. Drag, or use arrow keys.",
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
  const reorderedPlan = page.getByRole("button", {
    name: "Move Plan saved views. Drag, or use arrow keys.",
  });
  await expect(reorderedPlan).toBeEnabled();
  await reorderedPlan.press("ArrowUp");
  await expect
    .poll(() => inProgressColumn.locator(".task-row-title").allTextContents())
    .toEqual(["Plan saved views", "Column capture"]);
  await expect(
    page.getByRole("button", {
      name: testInfo.project.name === "mobile" ? "Views" : "Work board",
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
      name: testInfo.project.name === "mobile" ? "Views" : "Work board",
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

test("orders several navigation views and exposes the rest from the mobile Views menu", async ({
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
  await page.getByRole("button", { name: "Move Focus earlier" }).click();

  const ordered = page.locator(".navigation-view-order li");
  await expect(ordered).toHaveCount(7);
  await expect(ordered.nth(0)).toContainText("Focus");
  await expect(ordered.nth(1)).toContainText("Today");
  await expect(ordered.nth(2)).toContainText("Upcoming");
  await expect(ordered.nth(3)).toContainText("Calendar");
  await expect(ordered.nth(4)).toContainText("Projects");
  await expect(ordered.nth(5)).toContainText("Archive");
  await expect(ordered.nth(6)).toContainText("Later");

  if (testInfo.project.name === "mobile") {
    const navigation = page.locator(".bottom-navigation");
    await expect(navigation.getByRole("button")).toHaveCount(4);
    await expect(
      navigation.getByRole("button", { name: "Views", exact: true }),
    ).toBeVisible();
    await expect(
      navigation.getByRole("button", { name: "Later", exact: true }),
    ).toHaveCount(0);
    await navigation
      .getByRole("button", { name: "Views", exact: true })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "Later", exact: true }),
    ).toBeVisible();
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

test("creates, edits, executes, and deletes a saved view", async ({
  page,
}, testInfo) => {
  await page.getByLabel("New task title").fill("Build the view editor");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await openViewsCatalog(page);
  await page.getByRole("button", { name: "Create view" }).click();
  await expect(
    page.getByRole("heading", { name: "Create a view" }),
  ).toBeVisible();

  await page.getByLabel("Name").fill("Open work");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Create a view" });
  const disclosureStartedAt = await page.evaluate(() => performance.now());
  await openViewEditorSection(editor, "Filter");
  const disclosureOpenMs = await page.evaluate(
    (start) => performance.now() - start,
    disclosureStartedAt,
  );
  expect(disclosureOpenMs).toBeLessThan(500);
  await testInfo.attach("view-editor-disclosure-profile.json", {
    body: JSON.stringify({ disclosureOpenMs }, null, 2),
    contentType: "application/json",
  });
  await page.getByRole("button", { name: "Expression", exact: true }).click();
  await page.getByLabel("Filter expression").fill("status == (");
  await expect(
    page.getByRole("button", { name: "Save view", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Builder", exact: true }).click();
  await page.getByLabel("Filter property").fill("status");
  await chooseOption(page, "Filter condition", "is");
  await chooseOption(page, "Filter value", "Open");
  await openViewEditorSection(editor, "Arrange");
  await page.getByLabel("Board column").fill("status");
  await page.getByLabel("Property to display").fill("priority");
  await page.getByRole("button", { name: "Add", exact: true }).last().click();
  await openViewEditorSection(editor, "New tasks");
  await chooseOption(page, "Default priority", "High");
  await page.getByRole("button", { name: "Save view", exact: true }).click();

  await expect(page.getByText("Open work", { exact: true })).toBeVisible();
  await page.getByText("Open work", { exact: true }).click();
  await expect(page.getByLabel("Open work board")).toBeVisible();
  await expect(page.locator(".views-screen.view-detail")).not.toHaveAttribute(
    "aria-live",
    "polite",
  );
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
  await expect(page.getByRole("dialog", { name: "Edit view" })).toBeVisible();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.getByRole("button", { name: "Save view", exact: true }).click();
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
  await page.getByRole("button", { name: "Save view", exact: true }).click();
  await expect(page.getByText("Focused work", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit Focused work" }).click();
  await page.getByRole("button", { name: "Delete view" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Delete view?" });
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("button", { name: "Delete view", exact: true })
    .click();
  await expect(page.getByText("Focused work", { exact: true })).toHaveCount(0);
});

test("uses one responsive editor for every saved view layout", async ({
  page,
}, testInfo) => {
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const tasknotes = await root.getDirectoryHandle("TaskNotes", {
      create: true,
    });
    const views = await tasknotes.getDirectoryHandle("views", {
      create: true,
    });
    const file = await views.getFileHandle("editor-layouts.base", {
      create: true,
    });
    const writable = await file.createWritable();
    await writable.write(`formulas:
  score: 'if(priority == "high", 2, 1)'
views:
  - type: tasknotesTaskList
    name: Editor List
    order: [status, due, formula.score]
    sort: [{ property: priority, direction: DESC }]
  - type: tasknotesKanban
    name: Editor Board
    groupBy: { property: status, direction: ASC }
  - type: tasknotesCalendar
    name: Editor Calendar
    options: { calendarView: listWeek, showDue: true }
  - type: tasknotesMiniCalendar
    name: Editor Mini
    options: { showScheduled: true }
`);
    await writable.close();
  });

  await openViewsCatalog(page);
  const layouts = [
    ["Editor List", "List"],
    ["Editor Board", "Board"],
    ["Editor Calendar", "Calendar"],
    ["Editor Mini", "Mini calendar"],
  ] as const;

  for (const [name, layout] of layouts) {
    await page.getByRole("button", { name: `Edit ${name}` }).click();
    const editor = page.getByRole("dialog", { name: "Edit view" });
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue(name);
    await expect(
      editor.getByRole("button", { name: layout, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    for (const section of [
      "View",
      "Computed properties",
      "Filter",
      "Arrange",
      "New tasks",
    ])
      await expect(
        editor.getByRole("heading", { name: section, exact: true }),
      ).toBeVisible();
    await expect(editor.locator(".view-layout-preview")).toHaveCount(0);
    await openViewEditorSection(editor, "Computed properties");
    await expect(editor.getByLabel("Computed property name 1")).toHaveValue(
      "score",
    );

    if (layout === "Board") {
      await openViewEditorSection(editor, "Arrange");
      await expect(editor.getByLabel("Board column")).toHaveValue("status");
    }
    if (layout === "Calendar") {
      await openViewEditorSection(editor, "Calendar");
      await expect(editor.getByLabel("Opens as")).toHaveAttribute(
        "data-value",
        "listWeek",
      );
      await expect(
        editor.getByText("Upcoming recurring instances"),
      ).toBeVisible();
    }
    if (layout === "Mini calendar") {
      await openViewEditorSection(editor, "Calendar");
      await expect(editor.getByText("Scheduled dates")).toBeVisible();
    }
    if (testInfo.project.name === "mobile") await expectTouchTargets(editor);

    const box = await editor.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (testInfo.project.name === "mobile") {
      expect(box!.width).toBe(viewport!.width);
      expect(box!.y).toBeGreaterThan(0);
    } else {
      expect(box!.width).toBeLessThan(viewport!.width);
      expect(box!.x).toBeGreaterThan(0);
    }

    await editor.getByRole("button", { name: "Close view editor" }).click();
    await expect(editor).toHaveCount(0);
  }
});

test("moves through mini calendar dates with standard grid keys", async ({
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
    const file = await views.getFileHandle("keyboard-mini.base", {
      create: true,
    });
    const writable = await file.createWritable();
    await writable.write(`views:
  - type: tasknotesMiniCalendar
    name: Keyboard mini
    options: { showScheduled: true }
`);
    await writable.close();
  });

  await openViewsCatalog(page);
  await page
    .getByRole("button", { name: "Keyboard mini", exact: true })
    .click();
  const grid = page.getByRole("grid");
  const start = grid.locator('[role="gridcell"][tabindex="0"]');
  await expect(start).toHaveCount(1);
  const startLabel = await start.getAttribute("aria-label");
  await start.focus();
  await start.press("ArrowRight");
  const next = page.locator('[role="gridcell"]:focus');
  await expect(next).toBeVisible();
  expect(await next.getAttribute("aria-label")).not.toBe(startLabel);

  const monthBefore = await grid.getAttribute("aria-label");
  await next.press("PageDown");
  await expect(grid).not.toHaveAttribute("aria-label", monthBefore ?? "");
  await expect(page.locator('[role="gridcell"]:focus')).toBeVisible();
});

test("edits formulas and makes them available to view controls", async ({
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
    const file = await views.getFileHandle("computed.base", { create: true });
    const writable = await file.createWritable();
    await writable.write(`formulas:
  score: 'if(priority == "high", 2, 1)'
views:
  - type: tasknotesTaskList
    name: Computed work
    order: [title]
`);
    await writable.close();
  });

  await openViewsCatalog(page);
  await page.getByRole("button", { name: "Edit Computed work" }).click();
  const editor = page.getByRole("dialog", { name: "Edit view" });
  await openViewEditorSection(editor, "Computed properties");
  await editor
    .getByLabel("Computed property expression 1")
    .fill('if(priority == "high", 4, 1)');
  await editor.getByRole("button", { name: "Add formula" }).click();
  await editor.getByLabel("Computed property name 2").fill("label");
  await editor
    .getByLabel("Computed property expression 2")
    .fill('if(formula.score > 1, "urgent", "normal")');
  await expect(editor.getByText("Computed properties are valid")).toBeVisible();

  await openViewEditorSection(editor, "Arrange");
  await editor.getByLabel("Property to display").fill("formula.label");
  await editor.getByRole("option", { name: /Label formula\.label/ }).click();
  await editor
    .locator(".add-view-property")
    .last()
    .getByRole("button", { name: "Add", exact: true })
    .click();
  await editor.getByRole("button", { name: "Save view" }).click();
  await expect(editor).toHaveCount(0);

  const source = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const tasknotes = await root.getDirectoryHandle("TaskNotes");
    const views = await tasknotes.getDirectoryHandle("views");
    const file = await views.getFileHandle("computed.base");
    return (await file.getFile()).text();
  });
  expect(source).toContain('if(priority == "high", 4, 1)');
  expect(source).toContain('if(formula.score > 1, "urgent", "normal")');
  expect(source).toContain("formula.label");

  await page.getByRole("button", { name: "Edit Computed work" }).click();
  await openViewEditorSection(
    page.getByRole("dialog", { name: "Edit view" }),
    "Computed properties",
  );
  await expect(page.getByLabel("Computed property name 2")).toHaveValue(
    "label",
  );
});

test("offers task actions without opening the editor", async ({ page }) => {
  await page.getByLabel("New task title").fill("Act from the task row");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await page
    .getByRole("button", { name: "Task actions for Act from the task row" })
    .click();
  await page.getByRole("menuitem", { name: "Start timer" }).click();
  await expect(page.getByText("Timer running", { exact: true })).toBeVisible();

  await page
    .getByRole("button", { name: "Task actions for Act from the task row" })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Stop timer" }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Stop timer" }).click();
  await expect(page.getByText("Timer running", { exact: true })).toHaveCount(0);

  await page
    .getByRole("button", { name: "Task actions for Act from the task row" })
    .click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(
    page.getByText("Act from the task row", { exact: true }),
  ).toHaveCount(0);
});

test("uses the plugin-inspired task action hierarchy", async ({
  page,
  context,
}, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByLabel("New task title").fill("Context action parent");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  const title = page.getByText("Context action parent", { exact: true });
  const startedAt = await page.evaluate(() => performance.now());
  await title.click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "Actions for Context action parent" }),
  ).toBeVisible();
  const menuOpenMs = await page.evaluate(
    (start) => performance.now() - start,
    startedAt,
  );
  await testInfo.attach("task-action-menu-profile.json", {
    body: JSON.stringify({ menuOpenMs }, null, 2),
    contentType: "application/json",
  });
  expect(menuOpenMs).toBeLessThan(500);

  await page.getByRole("menuitem", { name: /Status/ }).click();
  await page.getByRole("menuitem", { name: "In progress" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);

  const trigger = page.getByRole("button", {
    name: "Task actions for Context action parent",
  });
  await trigger.click();
  await page.getByRole("menuitem", { name: /Priority/ }).click();
  await page.getByRole("menuitem", { name: "High" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);

  await trigger.click();
  await page.getByRole("menuitem", { name: /Dates/ }).click();
  await page.getByRole("menuitem", { name: "Due today" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);

  await trigger.click();
  const organizeStartedAt = await page.evaluate(() => performance.now());
  await page.getByRole("menuitem", { name: "Organize" }).click();
  const relationshipsAction = page.getByRole("menuitem", {
    name: /Edit relationships/,
  });
  await expect(relationshipsAction).toBeVisible();
  const organizePanelMs = await page.evaluate(
    (start) => performance.now() - start,
    organizeStartedAt,
  );
  expect(organizePanelMs).toBeLessThan(500);
  await testInfo.attach("task-action-organize-profile.json", {
    body: JSON.stringify({ organizePanelMs }, null, 2),
    contentType: "application/json",
  });
  const [relationshipLabel, relationshipDetail, relationshipButton] =
    await Promise.all([
      relationshipsAction.locator("span").boundingBox(),
      relationshipsAction.locator("small").boundingBox(),
      relationshipsAction.boundingBox(),
    ]);
  expect(relationshipLabel).not.toBeNull();
  expect(relationshipDetail).not.toBeNull();
  expect(relationshipButton).not.toBeNull();
  expect(relationshipDetail!.y).toBeGreaterThan(relationshipLabel!.y);
  expect(relationshipDetail!.x + relationshipDetail!.width).toBeLessThanOrEqual(
    relationshipButton!.x + relationshipButton!.width - 8,
  );
  await page.getByRole("menuitem", { name: "Create subtask" }).click();
  await page.getByLabel("Subtask title").fill("Context action child");
  await page.getByRole("button", { name: "Add subtask" }).click();
  await expect(
    page.getByText("Context action child", { exact: true }),
  ).toBeVisible();

  await trigger.click();
  await page.getByRole("menuitem", { name: "Copy" }).click();
  await page.getByRole("menuitem", { name: /Copy task link/ }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^\[\[tasks\/\d+\]\]$/);
  const copiedLink = await page.evaluate(() => navigator.clipboard.readText());

  const today = await page.evaluate(() => {
    const value = new Date();
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0"),
    ].join("-");
  });
  await expect
    .poll(async () => {
      const documents = await localTaskDocuments(page);
      const parent = documents.find((source) =>
        source.includes("Context action parent"),
      );
      const child = documents.find((source) =>
        source.includes("Context action child"),
      );
      return {
        parent:
          parent?.includes("status: in-progress") &&
          parent.includes("priority: high") &&
          parent.includes(`due: ${today}`),
        child: child?.includes(copiedLink),
      };
    })
    .toEqual({ parent: true, child: true });

  await page.reload();
  await expect(
    page.getByText("Context action parent", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Context action child", { exact: true }),
  ).toBeVisible();
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
