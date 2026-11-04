import { expect, test, type Page } from "./local-test";

const rows = (page: Page) =>
  page.locator("[data-task-selection-list] .task-row");
const openDemo = async (page: Page, count = 60) => {
  await page.goto(`?demo=${count}`);
  await expect(rows(page).first()).toBeVisible();
};
test.use({ timezoneId: "UTC" });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-04T12:00:00Z"));
});
const selectedRows = (page: Page) =>
  rows(page).filter({
    has: page.locator(".task-row-title[aria-pressed=true]"),
  });
const selectTwo = async (page: Page) => {
  await rows(page).first().locator(".task-row-title").focus();
  await page.keyboard.press("v");
  // Skip the recurring demo task at index 1.
  await rows(page).nth(2).locator(".task-row-title").focus();
  await page.keyboard.press("v");
  await expect(page.locator(".bulk-actions")).toContainText("2 selected");
};

test("modifier clicks select and range; plain clicks and completion retain their action", async ({
  page,
}) => {
  await openDemo(page);
  await rows(page)
    .first()
    .locator(".task-row-title")
    .click({ modifiers: ["ControlOrMeta"] });
  await rows(page)
    .nth(3)
    .locator(".task-row-title")
    .click({ modifiers: ["Shift"] });
  await expect(selectedRows(page)).toHaveCount(4);
  await page.keyboard.press("Escape");
  await expect(selectedRows(page)).toHaveCount(0);
  await rows(page)
    .first()
    .locator(".task-row-title")
    .click({ modifiers: ["ControlOrMeta"] });
  const title = (await rows(page)
    .first()
    .locator(".task-row-title")
    .textContent())!;
  await rows(page).first().locator(".task-row-title").click();
  await expect(
    page.getByRole("textbox", { name: "Task title", exact: true }),
  ).toHaveValue(title);
  await expect(page.locator(".bulk-actions")).toHaveCount(0);
});

test("keyboard selection extends, contracts, selects all and yields to typing and menus", async ({
  page,
}) => {
  await openDemo(page);
  await rows(page).first().locator(".task-row-title").focus();
  await page.keyboard.press("v");
  await page.keyboard.press("Shift+J");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(selectedRows(page)).toHaveCount(3);
  await page.keyboard.press("Shift+ArrowUp");
  await expect(selectedRows(page)).toHaveCount(2);
  const count = await rows(page).count();
  await page.keyboard.press("ControlOrMeta+a");
  await expect(selectedRows(page)).toHaveCount(count);
  await page.keyboard.press("Escape");
  await page.getByLabel("View options", { exact: true }).click();
  await page.keyboard.press("v");
  await expect(selectedRows(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.getByRole("combobox", {
    name: "Search commands and tasks",
  });
  await input.fill("v");
  await input.press("ControlOrMeta+a");
  await expect(selectedRows(page)).toHaveCount(0);
});

test("bulk schedule keeps one Undo for all rows, including those leaving the query", async ({
  page,
}) => {
  await openDemo(page);
  const titles = await rows(page).locator(".task-row-title").allTextContents();
  await selectTwo(page);
  await page.getByRole("combobox", { name: "Schedule selected tasks" }).click();
  await page.getByRole("option", { name: "Tomorrow" }).click();
  await expect(
    page.getByText("2 tasks updated", { exact: true }),
  ).toBeVisible();
  for (const title of [titles[0], titles[2]])
    await expect(
      rows(page).getByRole("button", { name: title, exact: true }),
    ).toHaveCount(0);
  await page
    .locator(".bulk-update-notice")
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  for (const title of [titles[0], titles[2]])
    await expect(
      rows(page).getByRole("button", { name: title, exact: true }),
    ).toBeVisible();
  await expect(page.locator(".bulk-update-notice")).toHaveCount(0);
});

for (const action of [
  "complete",
  "priority",
  "project",
  "archive",
  "delete",
] as const) {
  test(`bulk ${action} has a single Undo restoring both tasks`, async ({
    page,
  }) => {
    await openDemo(page);
    const ids = await rows(page).evaluateAll((elements) => [
      elements[0].getAttribute("data-task-id"),
      elements[2].getAttribute("data-task-id"),
    ]);
    await selectTwo(page);
    if (action === "priority") {
      await page
        .getByRole("combobox", { name: "Priority for selected tasks" })
        .click();
      await page.getByRole("option", { name: "Low" }).click();
    } else if (action === "project") {
      await page
        .getByRole("combobox", { name: "Move selected tasks to project" })
        .click();
      await page.getByRole("option", { name: "Operations" }).click();
    } else
      await page
        .locator(".bulk-actions")
        .getByRole("button", {
          name: action[0].toUpperCase() + action.slice(1),
          exact: true,
        })
        .click();
    if (action === "delete")
      await expect(
        page.getByText("2 tasks scheduled for deletion", { exact: true }),
      ).toBeVisible();
    else
      await expect(
        page.getByText("2 tasks updated", { exact: true }),
      ).toBeVisible();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    for (const id of ids)
      await expect(
        page.locator(`.task-row[data-task-id="${id}"]`),
      ).toBeVisible();
    await expect(page.locator(".bulk-update-notice")).toHaveCount(0);
  });
}

test("repeating tasks stay selected and explain why they are excluded", async ({
  page,
}) => {
  await openDemo(page);
  const repeating = rows(page).filter({
    has: page.getByRole("button", {
      name: "Test reminder delivery on Android",
      exact: true,
    }),
  });
  await repeating.locator(".task-row-title").focus();
  await page.keyboard.press("v");
  await expect(page.locator(".bulk-actions")).toContainText(
    "1 repeating task excluded",
  );
  await expect(
    page
      .locator(".bulk-actions")
      .getByRole("button", { name: "Complete", exact: true }),
  ).toBeDisabled();
  await expect(repeating).toHaveAttribute("data-selected", "true");
});

test("virtual lists select all data and extend beyond the mounted window", async ({
  page,
}) => {
  await openDemo(page, 500);
  const titles = rows(page).locator(".task-row-title");
  await titles.first().focus();
  const mounted = await rows(page).count();
  await page.keyboard.press("ControlOrMeta+a");
  const selectedCount = Number(
    (await page.locator(".bulk-selection-count strong").textContent())!.split(
      " ",
    )[0],
  );
  expect(selectedCount).toBeGreaterThan(mounted);
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  for (let index = 0; index < mounted + 3; index++)
    await page.keyboard.press("Shift+ArrowDown");
  await expect(page.locator(".bulk-selection-count strong")).toHaveText(
    `${mounted + 4} selected`,
  );
  await expect(page.locator(".task-row-title:focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".bulk-actions")).toHaveCount(0);
});

test("page menu enters selection mode, query collapse and navigation clear selections", async ({
  page,
}) => {
  await openDemo(page);
  await page.getByLabel("View options", { exact: true }).click();
  await page.getByRole("button", { name: "Select tasks", exact: true }).click();
  await expect(page.locator(".bulk-actions")).toContainText(
    "Tap tasks to select them.",
  );
  await rows(page).first().locator(".task-row-title").click();
  await expect(selectedRows(page)).toHaveCount(1);
  await page.getByRole("button", { name: /^Today \d+$/ }).click();
  await expect(selectedRows(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+k");
  await page
    .getByRole("combobox", { name: "Search commands and tasks" })
    .fill("Search");
  await page.getByRole("option", { name: /^Search/ }).click();
  await expect(page.locator(".bulk-actions")).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search tasks" }).fill("Review");
  await expect(rows(page).first()).toBeVisible();
  await rows(page).first().locator(".task-row-title").focus();
  await page.keyboard.press("v");
  await page
    .getByRole("searchbox", { name: "Search tasks" })
    .fill("no-such-task-xyz");
  await expect(selectedRows(page)).toHaveCount(0);
});

test("touch long press selects, tap toggles, and swipes still act outside selection mode", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Touch gestures");
  await openDemo(page);
  const row = rows(page).first();
  const title = row.locator(".task-row-title");
  await title.dispatchEvent("pointerdown", {
    pointerType: "touch",
    pointerId: 2,
    clientX: 150,
    clientY: 250,
  });
  await page.waitForTimeout(550);
  await title.dispatchEvent("pointerup", {
    pointerType: "touch",
    pointerId: 2,
    clientX: 150,
    clientY: 250,
  });
  await title.dispatchEvent("click", { pointerType: "touch" });
  await expect(selectedRows(page)).toHaveCount(1);
  await rows(page).nth(2).locator(".task-row-title").tap();
  await expect(selectedRows(page)).toHaveCount(2);
  await page
    .locator(".bulk-actions")
    .getByRole("button", { name: "Clear", exact: true })
    .tap();
  await title.dispatchEvent("pointerdown", {
    pointerType: "touch",
    pointerId: 3,
    clientX: 80,
    clientY: 250,
  });
  await title.dispatchEvent("pointermove", {
    pointerType: "touch",
    pointerId: 3,
    clientX: 190,
    clientY: 250,
  });
  await title.dispatchEvent("pointerup", {
    pointerType: "touch",
    pointerId: 3,
    clientX: 190,
    clientY: 250,
  });
  await expect(page.locator(".bulk-actions")).toHaveCount(0);
  await expect(row).not.toHaveAttribute("data-selected", "true");
  // Native touch context menus can arrive before the hold timer.
  await openDemo(page);
  await title.dispatchEvent("pointerdown", {
    pointerType: "touch",
    pointerId: 5,
    clientX: 150,
    clientY: 250,
  });
  await title.dispatchEvent("contextmenu", { clientX: 150, clientY: 250 });
  await title.dispatchEvent("pointerup", {
    pointerType: "touch",
    pointerId: 5,
    clientX: 150,
    clientY: 250,
  });
  await title.dispatchEvent("click", { pointerType: "touch" });
  await expect(selectedRows(page)).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("project lists share selection and drop collapsed rows from it", async ({
  page,
}) => {
  await page.goto(
    `views/${encodeURIComponent("TaskNotes/Views/projects.base#projects")}?demo=60`,
  );
  await expect(rows(page).first()).toBeVisible();
  const group = page.locator(".project-group").first();
  await group.locator(".task-row-title").first().focus();
  await page.keyboard.press("v");
  await expect(page.locator(".bulk-actions")).toContainText("1 selected");
  await group.locator(".project-toggle").click();
  await expect(selectedRows(page)).toHaveCount(0);
  await expect(page.locator(".bulk-selection-count strong")).toHaveText(
    "0 selected",
  );
});

test("schedule offers no date and an explicitly applied picked date, with Undo", async ({
  page,
}) => {
  await openDemo(page);
  for (const choice of ["none", "pick"]) {
    await selectTwo(page);
    await page
      .getByRole("combobox", { name: "Schedule selected tasks" })
      .click();
    await page
      .getByRole("option", { name: choice === "none" ? "No date" : "Pick date" })
      .click();
    if (choice === "pick") {
      await page
        .getByLabel("Schedule date", { exact: true })
        .fill("2026-11-12");
      await expect(page.locator(".bulk-update-notice")).toHaveCount(0);
      await page
        .getByRole("button", { name: "Apply date", exact: true })
        .click();
    }
    await expect(
      page.getByText("2 tasks updated", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(rows(page).first().locator(".task-row-title")).toHaveText(
      "Send the research summary to Rowan",
    );
    await expect(rows(page).nth(2).locator(".task-row-title")).toHaveText(
      "Review demo task 17",
    );
  }
});
