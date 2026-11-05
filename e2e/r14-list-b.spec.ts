import { expect, test } from "./local-test";

const upcoming = `views/${encodeURIComponent("TaskNotes/Views/upcoming.base#upcoming")}?demo=60&many-options`;

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme });
    test.beforeEach(async ({ page, isMobile }) => {
      await page.setViewportSize({ width: isMobile ? 412 : 1280, height: 713 });
      await page.emulateMedia({ reducedMotion: "reduce" });
    });

    test("calendar layouts reset outer scrolling and retain a shared control row", async ({
      page,
      isMobile,
    }, info) => {
      await page.goto(upcoming);
      const commands = page.locator(".full-calendar-commandbar");
      const title = page.locator(".view-header");
      const agenda = page.locator(".full-calendar-workspace");
      expect((await title.boundingBox())!.x).toBeCloseTo(
        (await agenda.boundingBox())!.x,
        0,
      );
      await page.screenshot({ path: info.outputPath("agenda.png") });
      const chosen = page.locator(".tnc-strip-day").nth(5);
      const date = await chosen.getAttribute("data-date");
      await chosen.click();
      await expect
        .poll(() => page.evaluate(() => scrollY))
        .toBeGreaterThan(200);
      await commands.getByLabel("Calendar layout", { exact: true }).click();
      await page.getByRole("button", { name: "Week", exact: true }).click();
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
      const selected = page.locator(`.tnc-dh[data-date="${date}"]`);
      await expect(selected).toBeInViewport();
      if (isMobile) {
        const scroller = page.locator(".tnc-tg-scroll");
        await scroller.evaluate((element) => {
          element.scrollLeft = 0;
        });
        await expect(page.locator(".full-calendar-view")).toHaveAttribute(
          "data-more-days",
          "true",
        );
        await page.screenshot({ path: info.outputPath("week-extent.png") });
        expect(
          await scroller.evaluate(
            (element) => element.scrollWidth > element.clientWidth,
          ),
        ).toBe(true);
        await scroller.evaluate((element) => {
          element.scrollLeft = element.scrollWidth;
        });
        await expect(page.locator(".full-calendar-view")).toHaveAttribute(
          "data-more-days",
          "false",
        );
        await selected.scrollIntoViewIfNeeded();
      }
      await page.screenshot({ path: info.outputPath("week.png") });
      for (const layout of ["Month", "3 days", "Day", "Agenda", "Year"]) {
        await commands.getByLabel("Calendar layout", { exact: true }).click();
        await page.getByRole("button", { name: layout, exact: true }).click();
        const previous = (await commands
          .getByRole("button", { name: "Previous period" })
          .boundingBox())!;
        const switcher = (await commands
          .getByLabel("Calendar layout", { exact: true })
          .boundingBox())!;
        expect(previous.height).toBeGreaterThanOrEqual(44);
        expect(switcher.height).toBeGreaterThanOrEqual(44);
        await expect
          .poll(() =>
            commands.evaluate((element) => {
              const navigation = element
                .querySelector(".full-calendar-navigation")!
                .getBoundingClientRect();
              const layout = element
                .querySelector(".view-options > summary")!
                .getBoundingClientRect();
              return Math.abs(navigation.top - layout.top);
            }),
          )
          .toBeLessThan(2);
        if (isMobile && !["Agenda", "3 days", "Day"].includes(layout)) {
          const heading = (await commands.locator("h2").boundingBox())!;
          const navigation = (await commands
            .locator(".full-calendar-navigation")
            .boundingBox())!;
          expect(heading.y).toBeGreaterThanOrEqual(
            navigation.y + navigation.height,
          );
        }
        if (layout === "Month" && isMobile) {
          await expect(page.locator(".tnc-dg-dow").first()).toHaveCSS(
            "font-size",
            "11px",
          );
          await expect(page.locator(".tnc-dg-dow").first()).toHaveCSS(
            "line-height",
            "16px",
          );
          await expect(page.locator(".tnc-dg-dots-more").first()).toHaveCSS(
            "font-size",
            "11px",
          );
          await page.screenshot({ path: info.outputPath("month.png") });
        }
      }
    });

    test("detail, time actions, search and Scratchpad remain compact", async ({
      page,
    }, info) => {
      await page.goto("?demo=60&many-options");
      const property = page.locator(".task-row-property").first();
      await expect(property).toHaveCSS("font-size", "13px");
      expect((await property.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.locator(".task-row-title").first().click();
      const pane = page.getByRole("complementary", {
        name: "Task details",
        exact: true,
      });
      await expect(
        pane.locator(".task-core-properties > .form-field").first(),
      ).toHaveCSS("font-size", "15px");
      await expect(pane.getByText("Rendering…", { exact: true })).toHaveCount(0);
      await page.screenshot({ path: info.outputPath("detail.png") });
      await pane.getByRole("combobox", { name: "Status", exact: true }).click();
      await expect(page.getByRole("option")).toHaveCount(12);
      await page.keyboard.press("End");
      await expect(page.getByRole("option").last()).toBeInViewport();
      await page.keyboard.press("Escape");
      await pane
        .getByRole("button", { name: "Scheduled time", exact: true })
        .click();
      const time = page.locator(".tasknotes-time-popover");
      for (const column of ["Hour", "Minute"])
        await expect(
          time
            .getByRole("listbox", { name: column })
            .getByRole("option")
            .first(),
        ).toHaveCSS("font-size", "16px");
      await expect(
        time.getByRole("button", { name: "Done", exact: true }),
      ).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await page.screenshot({ path: info.outputPath("time.png") });
      await page.keyboard.press("Escape");
      await page.goto("search?demo=60&many-options");
      await page
        .getByRole("searchbox", { name: "Search tasks" })
        .fill("no-such-r14-task");
      const empty = page.locator(".empty-state");
      await expect(empty).toBeVisible();
      const field = (await page.locator(".search-field").boundingBox())!;
      const heading = (await empty.locator("h2").boundingBox())!;
      expect(heading.y - field.y - field.height).toBeGreaterThanOrEqual(32);
      expect(heading.y - field.y - field.height).toBeLessThanOrEqual(40);
      await page.screenshot({ path: info.outputPath("search.png") });
      await page.goto("scratchpad/?demo=60&many-options");
      const unavailable = page.locator(".scratch-image-frame.is-unavailable");
      await expect(unavailable).toBeAttached();
      expect((await unavailable.boundingBox())!.height).toBeGreaterThanOrEqual(
        72,
      );
      expect((await unavailable.boundingBox())!.height).toBeLessThanOrEqual(96);
      await page
        .getByRole("button", { name: "Add image", exact: true })
        .click();
      const panel = page.locator("#scratchpad-image-capture");
      await expect(panel.locator("header")).toBeInViewport();
      await expect(
        panel.getByText("Upload images", { exact: true }),
      ).toBeInViewport();
      await page.screenshot({ path: info.outputPath("scratchpad.png") });
      await unavailable.screenshot({ path: info.outputPath("unavailable.png") });
      await page.goto("more/device?demo=60&many-options");
      const language = page.getByLabel("App language", { exact: true });
      await expect(language).toHaveCSS("appearance", "none");
      expect((await language.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const groups = page.locator(".device-settings > .settings-group");
      const firstGroup = (await groups.nth(0).boundingBox())!;
      const nextHeading = (await groups.nth(1).locator("h3").boundingBox())!;
      expect(
        nextHeading.y - firstGroup.y - firstGroup.height,
      ).toBeGreaterThanOrEqual(24);
      expect(
        nextHeading.y - firstGroup.y - firstGroup.height,
      ).toBeLessThanOrEqual(32);
      await page.screenshot({ path: info.outputPath("settings.png") });
    });
  });
}
