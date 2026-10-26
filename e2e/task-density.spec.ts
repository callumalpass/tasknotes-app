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
      const titleText = row.locator(".task-row-title-text");
      // Growing the row alone does not prove the entire title is readable:
      // a two-line clamp still hid words while metadata grew at 200% text.
      await expect
        .poll(() =>
          titleText.evaluate((element) =>
            Math.ceil(
              element.getBoundingClientRect().height /
                Number.parseFloat(getComputedStyle(element).lineHeight),
            ),
          ),
        )
        .toBeGreaterThan(2);
      expect(
        await titleText.evaluate(
          (element) => element.scrollHeight - element.clientHeight,
        ),
      ).toBeLessThanOrEqual(1);
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
      // URLs and other unbroken titles must also stay readable inside the row.
      await titleText.evaluate((element) => {
        element.textContent =
          "Review https://example.test/quarterly-planning-session-follow-up";
      });
      expect(
        await titleText.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      expect(
        await titleText.evaluate(
          (element) => element.scrollHeight - element.clientHeight,
        ),
      ).toBeLessThanOrEqual(1);
    });

    test("calendar stays compact on phones and desktop without double agenda padding", async ({
      page,
    }) => {
      await page.goto(calendar);
      const phone = (page.viewportSize()?.width ?? 0) < 840;
      // Phone months draw dots; wider months draw 24px bars.
      const dot = page.locator(".tnc-dg-dots .tnc-item--indicator").first();
      if (phone) {
        await expect(dot).toBeVisible();
        expect((await dot.boundingBox())!.height).toBeLessThanOrEqual(10);
      } else {
        const event = page
          .locator(".tnc-dg .tnc-item .full-calendar-event-content")
          .first();
        await expect(event).toBeVisible();
        await expect(event).toHaveCSS("min-height", "24px");
        expect((await event.boundingBox())!.height).toBeLessThanOrEqual(28);
      }
      await page.getByRole("button", { name: "Agenda", exact: true }).click();
      const agenda = page.locator(".tnc-item--list").first();
      await expect(agenda).toBeVisible();
      await expect(agenda).toHaveCSS("padding-top", "4px");
      // Wrapped metadata may grow on phones; only the padding overhead is fixed.
      // Phones stack the time above the title, so it is content, not padding.
      const contentHeight = (await agenda
        .locator(".full-calendar-event-content")
        .boundingBox())!.height;
      const stackedTime = phone
        ? await agenda
            .locator(".full-calendar-event-time")
            .evaluate((time) => time.getBoundingClientRect().height)
        : 0;
      expect(
        (await agenda.boundingBox())!.height - contentHeight - stackedTime,
      ).toBeLessThanOrEqual(9);
      await page.getByRole("button", { name: "Month", exact: true }).click();
      await page.setViewportSize({ width: 390, height: 844 });
      // Phone months draw dots; tapping a day lists its tasks below the grid.
      await expect(dot).toBeVisible();
      await page.locator(".tnc-dg-day.is-today").click();
      const dayTask = page
        .getByRole("complementary", { name: "Selected day" })
        .locator(".task-row-title")
        .first();
      await dayTask.click();
      await expect(
        page.getByRole("textbox", { name: "Task title", exact: true }),
      ).toBeVisible();
    });
  });
}
