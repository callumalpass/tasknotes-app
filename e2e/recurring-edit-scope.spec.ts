import { expect, test } from "./local-test";

test.use({ timezoneId: "UTC" });

// Cover every starting weekday, including the month boundary in the next week.
for (const day of [25, 26, 27, 28, 29, 30, 31]) {
  test(`moving one generated occurrence asks first and makes an occurrence note (October ${day})`, async ({
    page,
  }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 840, "Desktop week view");
    await page.clock.setFixedTime(new Date(`2026-10-${day}T12:00:00Z`));
    await page.goto(
      `views/${encodeURIComponent("TaskNotes/Views/calendar.base#calendar")}?demo=50`,
    );
    await page.getByRole("button", { name: "Week", exact: true }).click();
    // The demo advances its Mon/Wed/Fri series to the next scheduled date.
    // From Thursday onward this week has no generated patterns left; use
    // next week to exercise a pattern, not the distinct next-scheduled item.
    await page.getByRole("button", { name: "Next period" }).click();
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
}
