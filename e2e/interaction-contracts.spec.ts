import { expect, test } from "@playwright/test";

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

test("mobile property editing is truly modal and restores its trigger", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?demo=50");
  const trigger = page
    .locator(".task-row")
    .first()
    .getByRole("button", { name: /^Scheduled:/ });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Edit Scheduled" });
  await expect(dialog).toBeVisible();
  expect(
    await page.locator("#root").evaluate((root) => (root as HTMLElement).inert),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Clear value" }).focus();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close property editor" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Clear value" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(
    await page.locator("#root").evaluate((root) => (root as HTMLElement).inert),
  ).toBe(false);
});
