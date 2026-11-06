import { expect, test } from "./local-test";
const view = (id: string) =>
  `views/${encodeURIComponent(`TaskNotes/Views/${id}.base#${id}`)}?demo=50`;

test("More dismisses on Tab and no longer owns background arrow keys", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?demo=50");
  const more = page.getByRole("button", { name: "More", exact: true });
  await more.click();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("menu", { name: "More" })).toHaveCount(0);
  const active = await page.evaluate(() => document.activeElement?.outerHTML);
  await page.keyboard.press("ArrowDown");
  expect(await page.evaluate(() => document.activeElement?.outerHTML)).toBe(
    active,
  );
  await more.click();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
});
test("calendar overflow owns focus and restores More on Escape", async ({
  page,
}) => {
  // Phone months show every task as a dot and list the selected day below
  // the grid, so only wider layouts have a More popover.
  test.skip(
    (page.viewportSize()?.width ?? 0) < 840,
    "No More popover on phones",
  );
  await page.goto(view("calendar"));
  const more = page.locator(".tnc-more").first();
  await more.focus();
  await page.keyboard.press("Enter");
  const popup = page.getByRole("dialog");
  await expect(popup).toBeVisible();
  await expect(page.locator(".view-context-capture")).toBeHidden();
  expect(
    await popup.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Tab");
  expect(
    await popup.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await expect(more).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(popup).toBeVisible();
  await popup.getByRole("button", { name: "Close additional tasks" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(popup).toHaveCount(0);
  await more.focus();
  await page.keyboard.press("Enter");
  await popup.getByRole("button", { name: "Close additional tasks" }).focus();
  await page.keyboard.press("Enter");
  await expect(popup).toHaveCount(0);
  await expect(more).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(popup).toBeVisible();
  await page.keyboard.press("Control+n");
  await expect(
    page.getByRole("dialog", { name: "New task", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".tnc-popover")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(popup).toBeVisible();
  await popup.locator(".tnc-item").first().focus();
  await page.keyboard.press("Enter");
  await expect(popup).toHaveCount(0);
  await expect(
    page.getByRole("complementary", { name: "Task details" }),
  ).toBeFocused();
});
test("Archive capture acknowledges the accepted task without moving the view", async ({
  page,
}) => {
  await page.goto(view("archive"));
  // The honest demo shows its seeded archived tasks. Capture must leave this
  // filtered result unchanged, not rely on a demo-only empty archive.
  const archivedTitles = page.locator(".task-row-title");
  await expect(archivedTitles).toHaveCount(3);
  const before = await archivedTitles.allTextContents();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  const capture = page.getByRole("dialog", { name: "New task" });
  await capture
    .getByRole("combobox", { name: "New task title" })
    .fill("Archive capture confirmation");
  await capture.getByRole("button", { name: "Add", exact: true }).click();
  await expect(capture).toHaveCount(0);
  await expect(archivedTitles).toHaveText(before);
  const notice = page.locator(".task-added-notice");
  await expect(notice).toContainText("Archive capture confirmation");
  await notice.getByRole("button", { name: "Open", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Task title", exact: true }),
  ).toHaveValue("Archive capture confirmation");
  await expect(notice).toHaveCount(0);
});
