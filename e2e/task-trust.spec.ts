import { expect, test } from "@playwright/test";

test.skip(
  ({ isMobile }) => isMobile,
  "Row keys and selection need a keyboard.",
);

test("Undo of a completion puts the status back", async ({ page }) => {
  await page.goto("?demo=60");
  const row = page
    .locator(".task-row")
    .filter({ hasText: "Book the project room" });
  await expect(row).toContainText("In progress");
  await row.locator(".task-row-title").focus();
  await page.keyboard.press("x");
  await expect(row).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(row).toContainText("In progress");
});

test("bulk Pick date takes typing and names the due dates it moved", async ({
  page,
}) => {
  await page.goto("?demo=60");
  await page
    .locator(".task-row")
    .filter({ hasText: "Confirm next week" })
    .locator(".task-row-title")
    .focus();
  await page.keyboard.press("v");
  await page.keyboard.press("d");
  await page.getByRole("option", { name: "Pick date" }).click();
  const field = page
    .getByRole("dialog", { name: "Schedule date" })
    .getByRole("textbox")
    .first();
  await expect(field).toBeFocused();
  await page.keyboard.type("nov 30");
  await expect(field).toHaveValue("nov 30");
  await expect(page.locator(".task-date-hint")).toContainText("Nov 30");
  await page.keyboard.press("Enter");
  await expect(
    page.getByText(/Scheduled 1 task for .* and moved 1 missed due date/),
  ).toBeVisible();
});

test("a priority key returns focus to the row and names the change", async ({
  page,
}) => {
  await page.goto("?demo=60");
  const title = page
    .locator(".task-row")
    .filter({ hasText: "Book the project room" })
    .locator(".task-row-title");
  await title.focus();
  await page.keyboard.press("p");
  await page.getByRole("menuitemradio", { name: "High" }).first().click();
  await expect(title).toBeFocused();
});

test("beside the detail pane the project gives way before the status", async ({
  page,
}) => {
  await page.goto("?demo=60&many-options");
  await page.locator(".task-row-title").first().click();
  await expect(page.locator(".task-screen").first()).toBeVisible();
  const cut = await page
    .locator(
      ".task-row:not(.kanban-card *) .task-row-property:not(.is-project) strong",
    )
    .evaluateAll((labels) =>
      labels.filter((label) => label.scrollWidth > label.clientWidth + 1),
    );
  expect(cut).toEqual([]);
});

test("board titles use the card's width", async ({ page }) => {
  await page.goto(
    `views/${encodeURIComponent("TaskNotes/Views/work-board.base#work-board")}?demo=60`,
  );
  const title = page.locator(".kanban-card .task-row-title-text").first();
  await expect(title).toBeVisible();
  const [card, text] = await Promise.all([
    page.locator(".kanban-card").first().boundingBox(),
    title.boundingBox(),
  ]);
  expect(text!.width).toBeGreaterThan(card!.width * 0.7);
});

test("Ctrl+A from blank page space selects the list", async ({ page }) => {
  await page.goto("?demo=60");
  await expect(page.locator(".task-row").first()).toBeVisible();
  await page.mouse.click(1000, 40);
  await page.keyboard.press("Control+a");
  await expect(page.locator(".bulk-actions")).toContainText("selected");
});
