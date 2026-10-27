import { expect, test } from "./local-test";

test("moving one generated occurrence asks first and makes an occurrence note", async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 0) < 840, "Desktop week view");
  await page.goto(
    `views/${encodeURIComponent("TaskNotes/Views/calendar.base#calendar")}?demo=50`,
  );
  await page.getByRole("button", { name: "Week", exact: true }).click();
  const patterns = page.locator(".tnc-tg .tnc-item.is-recurring-pattern");
  await expect(patterns.first()).toBeVisible();
  const before = await patterns.count();
  await patterns.first().focus();
  await page.keyboard.press("Alt+ArrowRight");

  const dialog = page.getByRole("alertdialog", {
    name: "Change a recurring task",
  });
  await expect(dialog).toBeVisible();
  // Same clock on another day: the series keeps its days, so only this occurrence is offered.
  await expect(
    dialog.getByRole("button", { name: /every occurrence/ }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "This occurrence" }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: "This occurrence" }).click();
  await expect(dialog).toBeHidden();
  // The note replaces the generated occurrence on its original day.
  await expect(patterns).toHaveCount(before - 1);
  await expect(page.locator(".inline-error")).toHaveCount(0);
});
