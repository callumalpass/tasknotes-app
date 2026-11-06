import { expect, test } from "./local-test";

const workBoard = `views/${encodeURIComponent("TaskNotes/Views/work-board.base#work-board")}?demo=60`;

test.beforeEach(async ({ page }) => {
  await page.goto("?demo=60");
  await expect(page.locator(".task-row").first()).toBeVisible();
});

test("completion shortcut undo clears its toast and restores row focus", async ({
  page,
}) => {
  const title = page.locator(".task-row-title").first();
  const label = (await title.getAttribute("aria-label"))!;
  await title.focus();
  await page.keyboard.press("x");
  await expect(page.locator(".task-completed-notice")).toContainText(
    `Completed “${label}”`,
  );
  await expect(
    page.getByRole("button", { name: label, exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".task-completed-notice")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: label, exact: true }),
  ).toBeFocused();
});

test("a board move confirms with Undo and restores the card", async ({
  page,
}) => {
  await page.goto(workBoard);
  const columns = page.locator(".kanban-column");
  const card = columns.nth(1).locator("[data-kanban-card-id]").first();
  const id = (await card.getAttribute("data-kanban-card-id"))!;
  await card.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".undo-toast")).toContainText("In progress");
  await expect(
    columns.nth(1).locator(`[data-kanban-card-id="${id}"]`),
  ).toHaveCount(0);
  await page
    .locator(".undo-toast")
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect(
    columns.nth(1).locator(`[data-kanban-card-id="${id}"]`),
  ).toBeVisible();
});

test("a task's circle selects rather than completes while selecting", async ({
  page,
}) => {
  await page.goto("?demo=60");
  await page
    .getByRole("button", { name: /Select tasks/ })
    .first()
    .click();
  const row = page.locator(".task-row").first();
  const title = await row.locator(".task-row-title").getAttribute("aria-label");
  await row.locator(".completion-control").click();
  await expect(page.locator(".bulk-actions")).toContainText("1 selected");
  await page.getByRole("button", { name: `Deselect ${title}` }).click();
  await expect(page.locator(".bulk-actions")).toContainText("0 selected");
  await expect(row).toContainText(title!);
  await expect(row).not.toHaveClass(/is-complete/);
});

test("a sidebar project opens as its own page and returns to all projects", async ({
  isMobile,
  page,
}) => {
  test.skip(isMobile, "The sidebar is a desktop surface.");
  await page.goto("?demo=60");
  const shortcut = page
    .getByRole("group", { name: "Busiest projects" })
    .getByRole("button", { name: /Operations/ });
  await shortcut.click();
  await expect(page.locator(".project-group")).toHaveCount(1);
  await expect(shortcut).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "All projects" }).click();
  await expect(page.locator(".project-group").nth(1)).toBeVisible();
  await expect(shortcut).not.toHaveAttribute("aria-current", "page");
});

test("one Escape closes the project picker and returns to the row", async ({
  isMobile,
  page,
}) => {
  test.skip(isMobile, "Phones move a task from its menu.");
  await page.goto("?demo=60");
  const title = page.locator(".task-row-title").first();
  await title.focus();
  await page.keyboard.press("+");
  await expect(page.getByPlaceholder("Find a project")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder("Find a project")).toHaveCount(0);
});
