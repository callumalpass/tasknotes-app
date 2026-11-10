import { expect, test, type Page } from "./local-test";

const rows = (page: Page) =>
  page.locator("[data-task-selection-list] .task-row");
const overdueRows = (page: Page) =>
  page.locator("#task-section-overdue .task-row");
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
const selectTwo = async (page: Page, candidates = rows(page)) => {
  await candidates.first().locator(".task-row-title").focus();
  await page.keyboard.press("v");
  await candidates.nth(2).locator(".task-row-title").focus();
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
    .locator(".task-row-title-text")
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
  const titles = await overdueRows(page)
    .locator(".task-row-title-text")
    .allTextContents();
  const properties = await overdueRows(page)
    .locator(".task-row-properties")
    .allTextContents();
  await selectTwo(page, overdueRows(page));
  await page.getByRole("combobox", { name: "Schedule selected tasks" }).click();
  await page.getByRole("option", { name: "Tomorrow" }).click();
  await expect(
    page.getByRole("group", { name: "Due dates that have passed" }),
  ).toContainText("1 due date has passed");
  await expect(page.locator(".bulk-update-notice")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Move due dates too", exact: true })
    .click();
  await expect(page.locator(".bulk-update-notice")).toContainText(
    "Scheduled 2 tasks for Tomorrow and moved 1 missed due date",
  );
  await expect(
    page
      .locator(".bulk-update-notice")
      .getByRole("button", { name: "Undo", exact: true }),
  ).toHaveCount(1);
  for (const title of [titles[0], titles[2]])
    await expect(
      rows(page).getByRole("button", { name: title, exact: true }),
    ).toHaveCount(0);
  await page
    .locator(".bulk-update-notice")
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  for (const index of [0, 2]) {
    await expect(
      rows(page).getByRole("button", { name: titles[index], exact: true }),
    ).toBeVisible();
    await expect(
      rows(page)
        .filter({
          has: page.getByRole("button", { name: titles[index], exact: true }),
        })
        .locator(".task-row-properties"),
    ).toHaveText(properties[index]);
  }
  await expect(page.locator(".bulk-update-notice")).toHaveCount(0);
});

for (const action of [
  "complete",
  "status",
  "priority",
  "tag",
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
    if (action === "status") {
      await page
        .getByRole("combobox", { name: "Status for selected tasks" })
        .click();
      await page.getByRole("option", { name: "In progress" }).click();
      await expect(
        page.locator(".bulk-update-notice").getByRole("status"),
      ).toContainText("Set status to In progress for");
    } else if (action === "tag") {
      await page
        .getByRole("combobox", {
          name: "Add or remove a tag on selected tasks",
        })
        .click();
      await page.getByRole("button", { name: "New tag…" }).click();
      await page.getByRole("textbox", { name: "New tag" }).fill("errand");
      await page.getByRole("button", { name: "Add tag" }).click();
      await expect(
        page.locator(".bulk-update-notice").getByRole("status"),
      ).toHaveText("Added tag errand to 2 tasks");
    } else if (action === "priority") {
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
        page.locator(".bulk-update-notice").getByRole("status"),
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
    "1 repeating task won’t change",
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
  isMobile,
}) => {
  await openDemo(page);
  await page.getByLabel("View options", { exact: true }).click();
  await page.getByRole("button", { name: "Select tasks", exact: true }).click();
  await expect(page.locator(".bulk-actions")).toContainText(
    isMobile ? "Tap tasks to select them." : "Click tasks to select them.",
  );
  await rows(page).first().locator(".task-row-title").click();
  await expect(selectedRows(page)).toHaveCount(1);
  await page.locator(".task-section-toggle").first().click();
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
    const titles = await overdueRows(page)
      .locator(".task-row-title-text")
      .allTextContents();
    const properties = await overdueRows(page)
      .locator(".task-row-properties")
      .allTextContents();
    await selectTwo(page, overdueRows(page));
    await page
      .getByRole("combobox", { name: "Schedule selected tasks" })
      .click();
    await page
      .getByRole("option", {
        name: choice === "none" ? "No date" : "Pick date",
      })
      .click();
    if (choice === "pick") {
      await page.getByText("Date options", { exact: true }).click();
      await page.getByLabel("Type a date").fill("2026-11-12");
      await expect(page.locator(".bulk-update-notice")).toHaveCount(0);
      await expect(page.locator(".task-date-hint")).toContainText("Nov 12");
      await page.getByLabel("Type a date").press("Enter");
      await expect(
        page.getByRole("group", { name: "Due dates that have passed" }),
      ).toContainText("1 due date has passed");
      await expect(page.locator(".bulk-update-notice")).toHaveCount(0);
      await page
        .getByRole("button", { name: "Move due dates too", exact: true })
        .click();
    }
    await expect(
      page.getByText(
        choice === "none"
          ? "Removed scheduled dates from 2 tasks"
          : "Scheduled 2 tasks for Thu, Nov 12 and moved 1 missed due date",
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    for (const index of [0, 2]) {
      await expect(
        rows(page).getByRole("button", { name: titles[index], exact: true }),
      ).toBeVisible();
      await expect(
        rows(page)
          .filter({
            has: page.getByRole("button", { name: titles[index], exact: true }),
          })
          .locator(".task-row-properties"),
      ).toHaveText(properties[index]);
    }
  }
});

test("selected scheduling requires a due-date decision and preserves Due when kept", async ({
  page,
}) => {
  await page.goto("?demo=60");
  const first = page.locator(".task-row").filter({
    has: page.getByRole("button", {
      name: "Prepare quarterly planning session",
      exact: true,
    }),
  });
  const due = await first
    .locator(".task-row-property.is-date")
    .filter({ hasText: "Due" })
    .textContent();
  await first.locator(".task-row-title").focus();
  await page.keyboard.press("v");
  await page.locator(".task-row-title").nth(2).focus();
  await page.keyboard.press("v");
  await page.getByRole("combobox", { name: "Schedule selected tasks" }).click();
  await page.getByRole("option", { name: "Tomorrow", exact: true }).click();
  await expect(page.locator(".bulk-update-notice")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Keep due dates", exact: true })
    .click();
  await expect(page.locator(".bulk-update-notice")).toContainText(
    "Scheduled 2 tasks for Tomorrow",
  );
  await expect(
    first.locator(".task-row-property.is-date").filter({ hasText: "Due" }),
  ).toHaveText(due!);
  await expect(
    page
      .locator(".bulk-update-notice")
      .getByRole("button", { name: "Undo", exact: true }),
  ).toBeInViewport();
});
