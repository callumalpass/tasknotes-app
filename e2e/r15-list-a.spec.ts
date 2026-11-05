import { expect, test, type Page } from "./local-test";

const route = (name: string, extra: string) =>
  `views/${encodeURIComponent(`TaskNotes/Views/${name}.base#${name}`)}?demo=60${extra}`;

async function layout(page: Page, name: string) {
  await page.getByLabel("Calendar layout", { exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
}

for (const theme of ["light", "dark"] as const) {
  for (const many of [false, true]) {
    test(`LIST A geometry and visual matrix: ${theme}, ${many ? "many" : "normal"} options`, async ({
      page,
    }, info) => {
      test.setTimeout(120_000);
      const phone = info.project.name === "mobile";
      const extra = many ? "&many-options" : "";
      await page.setViewportSize({ width: phone ? 412 : 1280, height: 713 });
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript(
        (value) => localStorage.setItem("tasknotes:theme", value),
        theme,
      );
      await page.goto(`?demo=60${extra}`);
      const rows = page.locator(".task-row");
      await expect(rows.first()).toBeVisible();
      const rowHeights = await rows.evaluateAll((entries) =>
        entries
          .slice(0, 4)
          .map((entry) => entry.getBoundingClientRect().height),
      );
      expect(Math.max(...rowHeights)).toBeLessThanOrEqual(phone ? 140 : 100);
      expect(
        Math.max(...rowHeights) - Math.min(...rowHeights),
      ).toBeLessThanOrEqual(48);
      if (phone) {
        await expect(
          rows.first().locator(".task-row-title"),
        ).toHaveAccessibleName("Prepare quarterly planning session");
        expect(
          (await rows.first().locator(".task-row-title").boundingBox())!.height,
        ).toBeGreaterThanOrEqual(24);
        await expect(
          rows.first().locator(".task-row-metadata-band"),
        ).toBeVisible();
        await expect(
          rows.first().locator(".task-row-metadata-band"),
        ).toContainText("Due");
        const band = rows.first().locator(".task-row-metadata-band");
        expect((await band.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await band.click();
        const sheet = page.getByRole("dialog", {
          name: "Task properties",
          exact: true,
        });
        await expect(
          sheet.getByRole("combobox", { name: "Status", exact: true }),
        ).toBeVisible();
        await expect(
          sheet.getByRole("combobox", { name: "Priority", exact: true }),
        ).toBeVisible();
        await expect(
          sheet.getByRole("button", { name: "Scheduled date", exact: true }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
      } else {
        await page.getByRole("button", { name: "Collapse sidebar" }).click();
        const destinations = page.locator(".navigation-destinations");
        const shortcut = page
          .locator(".navigation-project-section button")
          .last();
        await shortcut.scrollIntoViewIfNeeded();
        const bounds = (await shortcut.boundingBox())!;
        const scroll = (await destinations.boundingBox())!;
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(
          scroll.y + scroll.height + 1,
        );
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        await page.getByRole("button", { name: "Expand sidebar" }).click();
      }
      await page.screenshot({ path: info.outputPath("today.png") });
      await rows.first().locator(".task-row-title").focus();
      await page.keyboard.press("v");
      await page.keyboard.press("Shift+J");
      const selectedRows = page.locator(".task-row.is-selected");
      await expect(selectedRows).toHaveCount(2);
      await expect(selectedRows.first()).toHaveCSS("padding-top", "1px");
      await expect(selectedRows.first()).toHaveCSS("padding-bottom", "1px");
      await expect(selectedRows.first()).toHaveCSS(
        "background-clip",
        "content-box",
      );
      await page.screenshot({ path: info.outputPath("selected.png") });
      await page.keyboard.press("Escape");

      await page.goto(route("upcoming", extra));
      await expect(page.locator(".tnc-strip-day").first()).toBeVisible();
      const firstUpcoming = page.locator(".tnc-item--list .task-row").first();
      await expect(firstUpcoming).toBeVisible();
      const firstTaskY = (await firstUpcoming.boundingBox())!.y;
      expect(firstTaskY).toBeLessThan(400);
      const stripDay = (await page
        .locator(".tnc-strip-day")
        .first()
        .boundingBox())!;
      expect(stripDay.height).toBeLessThanOrEqual(72);
      expect(stripDay.height).toBeGreaterThanOrEqual(60);
      expect(
        (await page.locator(".tnc-strip-head").boundingBox())!.height,
      ).toBeLessThanOrEqual(48);
      await page.screenshot({ path: info.outputPath("upcoming.png") });
      await expect(
        page.getByLabel("Calendar layout", { exact: true }).locator("svg"),
      ).toBeVisible();
      await page.locator(".tnc-strip-title").click();
      expect((await firstUpcoming.boundingBox())!.y).toBeLessThan(600);
      await page.screenshot({ path: info.outputPath("upcoming-expanded.png") });

      await page.goto(route("calendar", extra));
      await expect(page.locator(".tnc-dg-day").first()).toBeVisible();
      if (!phone) {
        const event = page.locator(".tnc-dg .tnc-item--bar").first();
        await expect(event).toBeVisible();
        expect((await event.boundingBox())!.height).toBeLessThanOrEqual(36);
        await expect(
          event.locator(".full-calendar-event-primary > span"),
        ).toHaveCSS("-webkit-line-clamp", "2");
      }
      await page.screenshot({ path: info.outputPath("month.png") });
      await layout(page, "Year");
      await expect(page.locator(".tnc-year-grid")).toBeVisible();
      if (!phone) {
        const columns = await page
          .locator(".tnc-year-grid")
          .evaluate(
            (grid) =>
              getComputedStyle(grid).gridTemplateColumns.split(" ").length,
          );
        expect(columns).toBeGreaterThanOrEqual(3);
        expect(
          (await page.locator(".tnc-ym-day").first().boundingBox())!.height,
        ).toBeLessThanOrEqual(28);
        const alignment = await page
          .locator(".tnc-ym-day.is-today")
          .evaluate((day) => {
            const heading = day.closest(".tnc-ym")!.getBoundingClientRect();
            const scroll = day
              .closest(".tnc-year-scroll")!
              .getBoundingClientRect();
            return heading.top - scroll.top;
          });
        expect(alignment).toBeGreaterThanOrEqual(0);
        expect(alignment).toBeLessThanOrEqual(20);
      }
      await page.screenshot({ path: info.outputPath("year.png") });
      await layout(page, "Week");
      await expect(page.locator(".tnc-tg-scroll")).toBeVisible();
      const tick = page
        .locator(".tnc-slot-label")
        .filter({ hasText: /^8\s*am$/i })
        .first();
      await expect(tick).toBeAttached();
      const tickBounds = (await tick.boundingBox())!;
      const divider = (await page.locator(".tnc-tg-top").boundingBox())!;
      expect(tickBounds.y).toBeGreaterThanOrEqual(
        divider.y + divider.height - 1,
      );
      if (phone)
        await expect(
          page.locator(".full-calendar-visible-days"),
        ).not.toBeEmpty();
      const timed = page
        .locator(".tnc-item--timed:not(.tnc-collision-hidden)")
        .first();
      await expect(timed).toBeAttached();
      await timed.focus();
      await expect(page.getByRole("tooltip")).toHaveText(
        (await timed.getAttribute("aria-label"))!,
      );
      await page.screenshot({ path: info.outputPath("week.png") });
      for (const mode of ["Day", "3 days"]) {
        await layout(page, mode);
        const firstTick = page
          .locator(".tnc-slot-label")
          .filter({ hasText: /^8\s*am$/i })
          .first();
        const top = (await page.locator(".tnc-tg-top").boundingBox())!;
        expect((await firstTick.boundingBox())!.y).toBeGreaterThanOrEqual(
          top.y + top.height - 1,
        );
      }

      await page.goto(`scratchpad?demo=60${extra}`);
      const editor = page.locator(".scratchpad-row-main").first();
      await expect(editor).toBeVisible();
      const input = editor.locator("textarea").first();
      const left = (await editor.boundingBox())!.x;
      expect((await input.boundingBox())!.x - left).toBe(44);
      const noteTitle = page
        .getByRole("textbox", { name: "Note title", exact: true })
        .last();
      await expect(noteTitle).toHaveCSS("font-size", "16px");
      await expect(noteTitle).toHaveCSS("font-weight", "400");
      await noteTitle.fill("Planning notes");
      await expect(noteTitle).toHaveCSS("font-size", "20px");
      await expect(noteTitle).toHaveCSS("font-weight", "600");
      await page.screenshot({ path: info.outputPath("scratchpad.png") });

      await page.goto(`views?demo=60${extra}`);
      await expect(
        page.getByRole("heading", { name: "Views", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "All views", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /^All \d+$/ }),
      ).toBeVisible();
      const firstView = page.locator(".saved-view-row").first();
      expect((await firstView.boundingBox())!.y).toBeLessThan(355);
      await page.screenshot({ path: info.outputPath("views.png") });
      await page
        .getByRole("button", { name: "Work board", exact: true })
        .click();
      const card = page.locator(".kanban-card").first();
      await expect(card).toBeVisible();
      if (phone) {
        await expect(card.locator(".task-row-title")).toHaveCSS(
          "min-height",
          "44px",
        );
        await expect(card.locator(".task-row-metadata-band")).toBeVisible();
        const property = (await card
          .locator(".task-row-metadata-band")
          .first()
          .boundingBox())!;
        expect(property.height).toBeGreaterThanOrEqual(44);
        expect(property.width).toBeGreaterThanOrEqual(44);
      } else {
        await expect(
          page.locator(".kanban-card .task-row-property > strong").first(),
        ).toHaveCSS("white-space", "normal");
        await expect(
          page.locator(".kanban-card .task-row-property > strong").first(),
        ).toHaveCSS("line-height", "20px");
      }
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) =>
              Number.isFinite(animation.effect?.getComputedTiming().endTime),
            )
            .map((animation) => animation.finished.catch(() => undefined)),
        );
      });
      await page.screenshot({
        path: info.outputPath("board.png"),
        animations: "disabled",
      });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow).toBe(false);
      console.log(
        JSON.stringify({ theme, many, phone, rowHeights, firstTaskY }),
      );
    });
  }
}
