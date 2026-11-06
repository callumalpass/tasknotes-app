import { expect, test } from "./local-test";

test("large lists keep a bounded DOM while scrolling and preserve detail focus", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("?demo=5000");
  await expect(page.locator(".task-row-title").first()).toBeVisible({
    timeout: 30_000,
  });
  expect(await page.locator(".task-row").count()).toBeLessThan(80);
  expect(await page.locator("*").count()).toBeLessThan(3000);
  const initial = await page.locator(".task-row-title").first().textContent();
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight / 2),
  );
  await expect
    .poll(() => page.locator(".task-row-title").first().textContent())
    .not.toBe(initial);
  const title = await page.locator(".task-row-title").evaluateAll(
    (nodes) =>
      nodes.find((node) => {
        const rect = node.getBoundingClientRect();
        return rect.top > 150 && rect.bottom < window.innerHeight - 100;
      })?.getAttribute("aria-label"),
  );
  expect(title).toBeTruthy();
  const trigger = page.getByRole("button", { name: title!, exact: true });
  await trigger.click();
  const detail = page.getByRole("complementary", { name: "Task details" });
  await expect(detail).toBeFocused();
  await detail
    .getByRole("button", { name: /^(Back|Close task details)$/ })
    .click();
  await expect(trigger).toBeFocused();
  await expect(page.getByText(/Loaded 200 of .* matching tasks/)).toBeVisible();
  await page
    .getByRole("button", { name: "Load more tasks", exact: true })
    .click();
  await expect(page.getByText(/Loaded 400 of .* matching tasks/)).toBeVisible();
  expect(await page.locator(".task-row").count()).toBeLessThan(80);
});

test("closing task details returns to the list after switching tasks", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto("?demo=50");
  const titles = page.locator(".task-row-title");
  await expect(titles.nth(1)).toBeVisible();
  const second = await titles.nth(1).getAttribute("aria-label");
  await titles.first().click();
  const detail = page.getByRole("complementary", { name: "Task details" });
  await expect(detail).toBeVisible();
  await page.getByRole("button", { name: second!, exact: true }).click();
  await expect(detail.getByLabel("Task title", { exact: true })).toHaveValue(
    second!,
  );

  await detail.getByRole("button", { name: "Close task details" }).click();
  await expect(detail).toBeHidden();
  await expect(page).not.toHaveURL(/\/task\//);
  await page.goForward();
  await expect(detail).toBeVisible();
  await page.goBack();
  await expect(detail).toBeHidden();
});

// Local, disposable fixtures only. These are failure-sequence contracts, not screenshots.
test("nested Escape preserves capture and dismissing preserves its draft", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?demo=50");
  await page.locator(".view-context-capture").click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  const input = dialog.getByRole("combobox", { name: "New task title" });
  await input.fill("Important task #wo");
  await expect(
    page.getByRole("listbox", { name: "Task field suggestions" }),
  ).toBeVisible();
  await input.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(input).toBeFocused();
  await input.fill("Book a room tomorrow");
  await dialog
    .getByRole("button", { name: "Edit scheduled", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Scheduled date", exact: true })
    .click();
  await expect(dialog.getByRole("grid")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("grid")).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close new task" }).click();
  await page.locator(".view-context-capture").click();
  await expect(input).toHaveValue("Book a room tomorrow");
  await dialog.getByRole("button", { name: "Discard draft" }).click();
  await expect(input).toHaveValue("");
});
