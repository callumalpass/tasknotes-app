import { expect, test } from "./local-test";

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme });

    test("board uses the available screen and calendar times stay within their events", async ({
      page,
      isMobile,
    }, testInfo) => {
      const width = isMobile ? 412 : 1280;
      await page.setViewportSize({ width, height: 713 });
      await page.addInitScript(() =>
        localStorage.setItem(
          "tasknotes:calendar-preferences:v1",
          JSON.stringify({ slotMinTime: "00:00:00", slotMaxTime: "24:00:00" }),
        ),
      );
      await page.goto(
        `views/${encodeURIComponent("TaskNotes/Views/work-board.base#work-board")}?demo=60`,
      );
      const board = page.locator(".kanban-board");
      await expect(board.locator(".kanban-card").first()).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
        .toBe(713);
      const boundary = isMobile
        ? (await page.locator(".bottom-navigation").boundingBox())!.y
        : 713;
      const bounds = (await board.boundingBox())!;
      expect(Math.abs(bounds.y + bounds.height - boundary)).toBeLessThanOrEqual(
        1,
      );
      if (isMobile) {
        expect(
          (await page.locator(".kanban-column").first().boundingBox())!.width,
        ).toBe(bounds.width);
      }
      await page.screenshot({
        path: testInfo.outputPath(`board-${width}-${colorScheme}.png`),
      });

      await page.goto("?demo=60&many-options");
      const title = page.locator(".task-row-title").first();
      await title.click();
      await page.locator(".task-properties-disclosure > summary").click();
      const status = page
        .getByRole("combobox", { name: "Status", exact: true })
        .first();
      await status.click();
      const filter = page.locator(".choice-options").getByRole("combobox");
      await expect(filter).toBeFocused();
      await filter.press("End");
      await expect(page.locator(".choice-options .is-active")).toBeInViewport({
        ratio: 1,
      });
      await page.screenshot({
        path: testInfo.outputPath(`picker-${width}-${colorScheme}.png`),
      });
      await filter.press("Escape");

      await page.goto(
        `views/${encodeURIComponent("TaskNotes/Views/calendar.base#calendar")}?demo=60`,
      );
      await expect(page.locator(".tnc--month")).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`calendar-${width}-${colorScheme}.png`),
      });
      await page.getByLabel("Calendar layout", { exact: true }).click();
      await page.getByRole("button", { name: "Week", exact: true }).click();
      const tracked = page.locator(".tnc-item.is-time-entry").first();
      await expect(tracked).toBeVisible();
      await tracked.scrollIntoViewIfNeeded();
      const eventBounds = (await tracked.boundingBox())!;
      const timeBounds = (await tracked
        .locator(".full-calendar-event-secondary")
        .boundingBox())!;
      expect(timeBounds.y + timeBounds.height).toBeLessThanOrEqual(
        eventBounds.y + eventBounds.height,
      );
      await page.screenshot({
        path: testInfo.outputPath(`calendar-week-${width}-${colorScheme}.png`),
      });
    });
  });
}
