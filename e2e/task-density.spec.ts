import { expect, test } from "./local-test";

const calendar = `views/${encodeURIComponent("TaskNotes/Views/calendar.base#calendar")}?demo=50`;

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme });

    test("task rows are compact without shrinking type or touch targets", async ({
      page,
    }) => {
      await page.goto("?demo=50");
      const compact = await page.evaluate(
        () =>
          matchMedia(
            "(min-width: 840px) and (hover: hover) and (pointer: fine)",
          ).matches,
      );
      const row = page.locator(".task-row").first();
      await expect(row).toBeVisible();
      const title = row.locator(".task-row-title");
      const property = row.locator(".task-row-property").first();
      await expect(title).toHaveCSS("min-height", compact ? "32px" : "44px");
      await expect(property).toHaveCSS("min-height", compact ? "24px" : "44px");
      const height = (await row.boundingBox())!.height;
      expect(height).toBeGreaterThanOrEqual(48);
      if (compact) expect(height).toBeLessThanOrEqual(64);
      await property.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(property).toBeFocused();
    });

    test("calendar density follows input mode and agenda avoids double padding", async ({
      page,
    }) => {
      await page.goto(calendar);
      const compact = await page.evaluate(
        () =>
          matchMedia(
            "(min-width: 840px) and (hover: hover) and (pointer: fine)",
          ).matches,
      );
      const event = page
        .locator(".fc-daygrid-event .full-calendar-event-content")
        .first();
      await expect(event).toBeVisible();
      await expect(event).toHaveCSS("min-height", compact ? "24px" : "44px");
      expect((await event.boundingBox())!.height).toBeLessThanOrEqual(
        compact ? 28 : 48,
      );
      await page.getByRole("button", { name: "Agenda", exact: true }).click();
      const agenda = page.locator(".fc-list-event").first();
      await expect(agenda).toBeVisible();
      await expect(agenda.locator("td").first()).toHaveCSS(
        "padding-top",
        compact ? "4px" : "2px",
      );
      // Wrapped metadata may grow on phones; only the padding overhead is fixed.
      const contentHeight = (await agenda
        .locator(".full-calendar-event-content")
        .boundingBox())!.height;
      expect(
        (await agenda.boundingBox())!.height - contentHeight,
      ).toBeLessThanOrEqual(compact ? 9 : 5);
      await page.getByRole("button", { name: "Month", exact: true }).click();
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(event).toHaveCSS("min-height", "44px");
    });
  });
}
