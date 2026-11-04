import { expect, test, type Page } from "./local-test";

const upcoming = "views/TaskNotes%2FViews%2Fupcoming.base%23upcoming?demo=60";

test.use({ timezoneId: "UTC" });

test.beforeEach(async ({ page, isMobile }) => {
  await page.setViewportSize(
    isMobile ? { width: 412, height: 915 } : { width: 1280, height: 800 },
  );
});

async function changeLayout(page: Page, name: string) {
  await page.getByLabel("Calendar layout", { exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
}

async function capture(page: Page, text: string) {
  if ((page.viewportSize()?.width ?? 0) < 840)
    await page.locator(".view-context-capture").click();
  const input = page.getByRole("combobox", { name: "New task title" });
  await input.fill(text);
  await expect(
    page.getByRole("button", { name: "Remove scheduled" }),
  ).toBeVisible();
  await input.press("Enter");
  const dialog = page.getByRole("dialog", { name: "New task", exact: true });
  if ((page.viewportSize()?.width ?? 0) < 840)
    await expect(dialog).toBeHidden();
  else await expect(input).toHaveValue("");
}

test("detail dates share tabs, text and shortcuts without leaving the viewport", async ({
  page,
}, testInfo) => {
  await page.goto("?demo=60&many-options");
  await page.locator(".task-row-title").first().click();
  const detail = page.getByRole("complementary", {
    name: "Task details",
    exact: true,
  });
  for (const field of ["Scheduled", "Due"]) {
    const trigger = detail.getByRole("button", {
      name: `${field} date`,
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole("dialog", {
      name: `${field} date calendar`,
      exact: true,
    });
    await expect(
      dialog.getByRole("radio", { name: new RegExp(field) }),
    ).toBeChecked();
    await expect(dialog.getByLabel("Type a date")).toBeFocused();
    await expect(
      dialog.getByRole("button", { name: "Today", exact: true }),
    ).toBeVisible();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      const bounds = (await dialog.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(
        page.viewportSize()!.width,
      );
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(
        page.viewportSize()!.height,
      );
      const lastDay = (await dialog
        .getByRole("gridcell")
        .last()
        .boundingBox())!;
      expect(lastDay.x + lastDay.width).toBeLessThanOrEqual(
        bounds.x + bounds.width,
      );
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`detail-${field}-${colorScheme}.png`),
      });
    }
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  }
  await detail.getByRole("button", { name: "Due date", exact: true }).click();
  const input = page.getByLabel("Type a date", { exact: true });
  await input.fill("tomorrow 9am");
  await expect(page.getByText(/^Enter to set/)).toBeVisible();
  await input.press("Enter");
  await expect(page.locator(".task-detail-date-popover")).toHaveCount(0);
  await expect(
    detail.getByRole("button", { name: "Due time", exact: true }),
  ).toHaveAttribute("data-value", "09:00");
  await page.setViewportSize({ width: 320, height: 568 });
  await detail.getByRole("button", { name: "Due date", exact: true }).click();
  const compact = page.getByRole("dialog", { name: "Due date calendar" });
  const compactBounds = (await compact.boundingBox())!;
  expect(compactBounds.x).toBeGreaterThanOrEqual(0);
  expect(compactBounds.x + compactBounds.width).toBeLessThanOrEqual(320);
  expect(compactBounds.y).toBeGreaterThanOrEqual(0);
  expect(compactBounds.y + compactBounds.height).toBeLessThanOrEqual(568);
  await compact.getByRole("gridcell").last().scrollIntoViewIfNeeded();
  await expect(compact.getByRole("gridcell").last()).toBeInViewport();
  await compact.getByRole("button", { name: "Close dates" }).click();
});

test("grid cards lead with titles, logs remain readable, and Week starts at the working day", async ({
  page,
  isMobile,
}, testInfo) => {
  await page.clock.install({ time: new Date("2026-11-04T11:00:00Z") });
  await page.goto(upcoming);
  await expect(page.locator(".tnc-item--list").first()).toBeVisible();
  await page.mouse.move(650, 500);
  await page.mouse.wheel(0, 1400);
  await changeLayout(page, "Week");
  const scroller = page.locator(".tnc-tg-scroll");
  await expect(scroller).toBeVisible();
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  const scroll = await scroller.evaluate((element) => ({
    top: element.scrollTop,
    max: element.scrollHeight - element.clientHeight,
  }));
  expect(scroll.top).toBeLessThan(scroll.max);
  await expect(
    page.getByRole("complementary", { name: "Selected day" }),
  ).toHaveCount(0);
  if (!isMobile)
    expect(
      (await page.locator(".full-calendar-main").boundingBox())!.width,
    ).toBeGreaterThan(950);
  const card = page.locator(".tnc-item--timed:not(.is-time-entry)").first();
  const title = card.locator(".full-calendar-event-primary > span");
  const time = card.locator(".full-calendar-event-secondary > time");
  await expect(title).toBeVisible();
  await expect(time).toBeVisible();
  const titleBounds = (await title.boundingBox())!;
  const timeBounds = (await time.boundingBox())!;
  expect(titleBounds.y + titleBounds.height).toBeLessThanOrEqual(timeBounds.y);
  expect(
    await title.evaluate(
      (element) => element.scrollHeight <= element.clientHeight + 1,
    ),
  ).toBe(true);
  const cardBounds = (await card.boundingBox())!;
  expect(timeBounds.y + timeBounds.height).toBeLessThanOrEqual(
    cardBounds.y + cardBounds.height,
  );
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({
      path: testInfo.outputPath(`upcoming-week-${colorScheme}.png`),
    });
  }
  await page.goto(
    "views/TaskNotes%2FViews%2Fcalendar.base%23calendar?demo=60&many-options",
  );
  await expect(page.locator(".tnc--month")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("calendar-month.png") });
  await changeLayout(page, "Week");
  const tracked = page.locator(".tnc-item.is-time-entry").first();
  await expect(
    tracked.locator(".full-calendar-event-primary > span"),
  ).not.toBeEmpty();
  await expect(tracked).not.toHaveClass(/is-actual/);
  await expect(tracked).toBeVisible();
  await tracked.scrollIntoViewIfNeeded();
  const trackedBounds = (await tracked.boundingBox())!;
  const trackedTitle = (await tracked
    .locator(".full-calendar-event-primary")
    .boundingBox())!;
  const trackedTime = (await tracked
    .locator(".full-calendar-event-secondary")
    .boundingBox())!;
  expect(trackedTitle.y).toBeGreaterThanOrEqual(trackedBounds.y);
  expect(trackedTime.y + trackedTime.height).toBeLessThanOrEqual(
    trackedBounds.y + trackedBounds.height,
  );
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({
      path: testInfo.outputPath(`calendar-week-${colorScheme}.png`),
    });
  }
});

test.describe("local calendar days", () => {
  test.use({ timezoneId: "Australia/Melbourne" });

  test("tomorrow 9am stays in Upcoming and all-day/timed counts agree", async ({
    page,
  }) => {
    await page.clock.install({ time: new Date("2026-11-04T00:00:00Z") });
    await page.goto(upcoming);
    const day = "2026-11-05";
    const stripDay = page.locator(`.tnc-strip-day[data-date="${day}"]`);
    await expect(stripDay.locator(".agenda-strip-count")).toHaveText(/\d+/);
    const before = Number(
      await stripDay.locator(".agenda-strip-count").textContent(),
    );
    await capture(page, "Melbourne morning review tomorrow 9am +Operations");
    await capture(page, "Melbourne all-day review tomorrow +Operations");
    await stripDay.click();
    const section = page.locator(`.tnc-list-section[data-date="${day}"]`);
    const morning = section.locator(".task-row", {
      hasText: "Melbourne morning review",
    });
    const allDay = section.locator(".task-row", {
      hasText: "Melbourne all-day review",
    });
    await expect(morning).toBeVisible();
    await expect(allDay).toBeVisible();
    await expect(morning).toContainText("Operations");
    await expect(morning.locator(".task-row-context")).toContainText("9");
    await expect(morning).not.toContainText("Tomorrow");
    await expect(allDay).not.toContainText("Tomorrow");
    await expect(stripDay.locator(".agenda-strip-count")).toHaveText(
      String(before + 2),
    );
    await expect(section.locator(".agenda-day-count")).toHaveText(
      String(before + 2),
    );
    await expect(section.locator(".tnc-item--list")).toHaveCount(before + 2);
    await expect(
      section.locator(".tnc-item--list", {
        hasText: "Melbourne morning review",
      }),
    ).toHaveAttribute("data-date", day);
    await page.getByLabel("Calendar layout").click();
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await expect(
      page.getByRole("complementary", { name: "Selected day" }),
    ).toHaveCount(0);
    await page.locator(`.tnc-tg-head .tnc-dh[data-date="${day}"]`).click();
    const inspector = page.getByRole("complementary", { name: "Selected day" });
    await expect(inspector).toContainText(`${before + 2} tasks`);
    await expect(
      inspector.getByRole("button", {
        name: "Melbourne morning review",
        exact: true,
      }),
    ).toBeVisible();
    await inspector.getByRole("button", { name: "Close day details" }).click();
    await expect(inspector).toHaveCount(0);
  });
});
