import { expect, test, type Page } from "./local-test";

const route = (name: string, many = false) =>
  `views/${encodeURIComponent(`TaskNotes/Views/${name}.base#${name}`)}?demo=60${many ? "&many-options" : ""}`;
async function layout(page: Page, name: string) {
  await page.getByLabel("Calendar layout", { exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
}

for (const theme of ["light", "dark"] as const) {
  for (const many of [false, true]) {
    test(`compact metadata, detail and calendar: ${theme}, many=${many}`, async ({
      page,
      isMobile,
    }, info) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: isMobile ? 412 : 1280, height: 713 });
      await page.clock.setFixedTime(new Date("2026-11-06T10:00:00"));
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript(
        (value) => localStorage.setItem("tasknotes:theme", value),
        theme,
      );
      await page.goto(`?demo=60${many ? "&many-options" : ""}`);
      const rows = page.locator(".task-row");
      await expect(rows.first()).toBeVisible();
      const heights = await rows.evaluateAll((entries) =>
        entries
          .slice(0, 5)
          .map((entry) => entry.getBoundingClientRect().height),
      );
      expect(Math.max(...heights)).toBeLessThanOrEqual(isMobile ? 100 : 82);
      const metadata = rows
        .first()
        .locator(
          isMobile ? ".task-row-metadata-band" : ".task-row-inline-metadata",
        );
      await expect(metadata).toHaveCSS("font-size", "14px");
      await expect(metadata).toHaveCSS("line-height", "20px");
      if (isMobile) {
        expect((await metadata.boundingBox())!.height).toBeGreaterThanOrEqual(
          44,
        );
        await metadata.tap();
        const sheet = page.getByRole("dialog", {
          name: "Task properties",
          exact: true,
        });
        await expect(sheet).toBeVisible();
        for (const name of ["Status", "Priority"])
          await expect(
            sheet.getByRole("combobox", { name, exact: true }),
          ).toBeVisible();
        for (const name of ["Scheduled date", "Due date"])
          await expect(
            sheet.getByRole("button", { name, exact: true }),
          ).toBeVisible();
        await sheet
          .getByRole("combobox", { name: "Priority", exact: true })
          .click();
        await expect(page.getByRole("option").first()).toBeVisible();
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
        await page.keyboard.press("Escape");
        await expect(sheet).toHaveCount(0);
      }
      await page.screenshot({ path: info.outputPath("today.png") });
      await rows.first().locator(".task-row-title").click();
      const detail = page.locator(".task-screen");
      const disclosure = detail.locator(".task-properties-disclosure");
      await expect(disclosure).not.toHaveAttribute("open");
      await expect(detail.locator(".task-notes-jump")).toHaveCount(0);
      expect(
        (await detail.locator(".notes-field").boundingBox())!.y,
      ).toBeLessThan(260);
      await expect(detail.locator(".notes-preview-surface")).toBeVisible();
      expect(
        (await detail.locator(".notes-preview-surface").boundingBox())!.y,
      ).toBeLessThanOrEqual(260);
      await page.screenshot({
        path: info.outputPath("detail.png"),
        animations: "disabled",
      });
      await disclosure.locator("summary").click();
      await expect(
        detail.getByRole("combobox", { name: "Status", exact: true }),
      ).toBeVisible();

      await page.goto(route("projects", many));
      const project = page.locator(".project-group").first();
      await expect(project).toBeVisible();
      const projectName = await project.locator("h2").innerText();
      await expect(
        project
          .locator(".task-row")
          .first()
          .locator(
            isMobile ? ".task-row-metadata-band" : ".task-row-inline-metadata",
          ),
      ).not.toContainText(projectName.replace(/\d+$/, "").trim());
      await page.screenshot({ path: info.outputPath("projects.png") });

      await page.goto("views?demo=60" + (many ? "&many-options" : ""));
      await page
        .getByRole("button", { name: "Work board", exact: true })
        .click();
      const card = page.locator(".kanban-card").first();
      await expect(card).toBeVisible();
      expect((await card.boundingBox())!.height).toBeLessThanOrEqual(135);
      const boardOverflow = await page
        .locator(".kanban-board")
        .evaluate((board) => board.scrollWidth > board.clientWidth + 1);
      await expect(
        page.getByRole("navigation", { name: "Board columns" }),
      ).toHaveCount(boardOverflow ? 1 : 0);
      await page.screenshot({ path: info.outputPath("board.png") });

      await page.goto(route("calendar", many));
      await expect(page.locator(".tnc-dg-day").first()).toBeVisible();
      await page.screenshot({ path: info.outputPath("month.png") });
      for (const title of ["Collision alpha", "Collision beta"]) {
        await page
          .getByRole("button", { name: "New task", exact: true })
          .click();
        const capture = page.getByRole("dialog", {
          name: "New task",
          exact: true,
        });
        const input = capture.getByRole("combobox", {
          name: "New task title",
          exact: true,
        });
        await input.fill(`${title} today at 9am`);
        await expect(
          capture.getByRole("button", { name: "Remove scheduled" }),
        ).toBeVisible();
        await input.press("Enter");
        await expect(capture).not.toBeVisible();
      }
      await layout(page, "Week");
      await expect(page.locator(".tnc-tg-scroll")).toBeVisible();
      const collisions = page.locator(".calendar-collision-trigger");
      await expect(collisions.first()).toBeAttached();
      const notice = page.locator(".task-added-notice");
      if (await notice.isVisible())
        await notice.getByRole("button", { name: "Dismiss" }).click();
      await collisions.first().scrollIntoViewIfNeeded();
      await collisions.first().focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("complementary", { name: "Selected day" }),
      ).toBeVisible();
      await page.screenshot({ path: info.outputPath("week.png") });
      for (const name of ["Day", "3 days"]) {
        await layout(page, name);
        const strip = page.locator(".tnc-strip");
        if (isMobile) {
          await expect(strip).toBeVisible();
          expect((await strip.boundingBox())!.height).toBeLessThanOrEqual(100);
          if (name === "Day")
            await expect(page.locator(".tnc-tg-head")).not.toBeVisible();
          expect(
            (await page.locator(".tnc-tg-top").boundingBox())!.height,
          ).toBeLessThanOrEqual(name === "Day" ? 105 : 150);
          await expect(
            page.locator(".tnc-tg-top .tnc-item:not(.tnc-preview-hidden)").first(),
          ).toBeVisible();
          await expect(page.locator(".tnc-tg-top .tnc-more").first()).toBeVisible();
        }
        await page.screenshot({ path: info.outputPath(`${name}.png`) });
      }
      console.log(JSON.stringify({ theme, many, isMobile, heights }));
    });
  }
}

test("touch month selection consumes its compatibility click, not the next intentional tap", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Requires a touch pointer");
  await page.setViewportSize({ width: 412, height: 713 });
  await page.clock.setFixedTime(new Date("2026-11-06T10:00:00"));
  await page.goto(route("calendar"));
  const day = page.locator('.tnc-dg-day[data-date="2026-11-06"]');
  await expect(day).toBeVisible();
  await day.tap();
  const agenda = page.getByRole("complementary", { name: "Selected day" });
  await expect(agenda).toBeVisible();
  await expect(agenda.locator(".task-row-title").first()).toBeInViewport();
  await expect(page).not.toHaveURL(/\/task\//);
  await expect(
    page.getByRole("textbox", { name: "Task title", exact: true }),
  ).toHaveCount(0);
  await agenda.locator(".task-row-title").first().tap();
  await expect(
    page.getByRole("textbox", { name: "Task title", exact: true }),
  ).toBeVisible();
});

test("week strip navigation and arrow keys keep the upcoming list aligned", async ({
  page,
}) => {
  await page.goto(route("upcoming"));
  const first = page.locator(".tnc-strip-day").first();
  await expect(first).toBeVisible();
  const initial = await first.getAttribute("data-date");
  await page.getByRole("button", { name: "Next week", exact: true }).click();
  await expect(first).not.toHaveAttribute("data-date", initial!);
  const date = await first.getAttribute("data-date");
  const heading = page.locator(`.tnc-list-day[data-date="${date}"]`);
  await expect(heading).toBeInViewport();
  const top = (await heading.boundingBox())!.y;
  const strip = (await page.locator(".tnc-strip").boundingBox())!;
  expect(top).toBeGreaterThanOrEqual(strip.y + strip.height - 2);
  expect(top).toBeLessThan(strip.y + strip.height + 60);
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".tnc-strip-day.is-focus")).not.toHaveAttribute(
    "data-date",
    date!,
  );
});
