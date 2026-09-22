import { expect, test } from "./local-test";

const calendar = `views/${encodeURIComponent("TaskNotes/Views/calendar.base#calendar")}?demo=50`;

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme });

    test("task rows are compact and properties remain directly editable", async ({
      page,
    }) => {
      await page.goto("?demo=50");
      const row = page.locator(".task-row").filter({
        has: page.getByRole("button", {
          name: "Book the project room",
          exact: true,
        }),
      });
      await expect(row).toBeVisible();
      const title = row.locator(".task-row-title");
      const property = row.locator(".task-row-property").first();
      await expect(title).toHaveCSS("min-height", "32px");
      await expect(property).toHaveCSS("min-height", "24px");
      for (const control of await row
        .locator(".completion-control, .task-actions-trigger")
        .all()) {
        const bounds = (await control.boundingBox())!;
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        expect(bounds.width).toBeGreaterThanOrEqual(44);
      }
      const titleBox = (await title.boundingBox())!;
      const propertyBox = (await property.boundingBox())!;
      expect(propertyBox.y).toBeGreaterThanOrEqual(
        titleBox.y + titleBox.height,
      );
      const height = (await row.boundingBox())!.height;
      expect(height).toBeGreaterThanOrEqual(48);
      expect(height).toBeLessThanOrEqual(60);
      await property.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(property).toBeFocused();
    });

    test("mobile rows grow for wrapped titles and enlarged text without overlapping actions", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 844 });
      await page.goto("?demo=50");
      const row = page.locator(".task-row").first();
      await expect(row).toBeVisible();
      const normalHeight = (await row.boundingBox())!.height;
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      await expect
        .poll(async () => (await row.boundingBox())!.height)
        .toBeGreaterThan(normalHeight);
      const title = (await row.locator(".task-row-title").boundingBox())!;
      for (const control of await row.locator(".task-row-property").all()) {
        const box = (await control.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(24);
        expect(box.y).toBeGreaterThanOrEqual(title.y + title.height);
        expect(box.x + box.width).toBeLessThanOrEqual(320);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(320);
    });

    test("calendar stays compact on phones and desktop without double agenda padding", async ({
      page,
    }) => {
      await page.goto(calendar);
      const event = page
        .locator(".fc-daygrid-event .full-calendar-event-content")
        .first();
      await expect(event).toBeVisible();
      await expect(event).toHaveCSS("min-height", "24px");
      expect((await event.boundingBox())!.height).toBeLessThanOrEqual(28);
      await page.getByRole("button", { name: "Agenda", exact: true }).click();
      const agenda = page.locator(".fc-list-event").first();
      await expect(agenda).toBeVisible();
      await expect(agenda.locator("td").first()).toHaveCSS(
        "padding-top",
        "4px",
      );
      // Wrapped metadata may grow on phones; only the padding overhead is fixed.
      const contentHeight = (await agenda
        .locator(".full-calendar-event-content")
        .boundingBox())!.height;
      expect(
        (await agenda.boundingBox())!.height - contentHeight,
      ).toBeLessThanOrEqual(9);
      await page.getByRole("button", { name: "Month", exact: true }).click();
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(event).toHaveCSS("min-height", "24px");
      // The compact event itself remains an independent task-opening target.
      await event.click();
      await expect(
        page.getByRole("textbox", { name: "Task title", exact: true }),
      ).toBeVisible();
    });
  });
}
