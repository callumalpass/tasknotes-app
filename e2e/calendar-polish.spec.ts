import { expect, test } from "./local-test";

const upcoming = "views/TaskNotes%2FViews%2Fupcoming.base%23upcoming?demo=60";

test.use({ timezoneId: "UTC", colorScheme: "dark" });

test("expanded agenda keeps round markers and collapses long empty runs", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(upcoming);
  await page.locator(".agenda-range-toggle").click();
  const strip = page.locator(".tnc-strip");
  await expect(strip).toHaveClass(/is-expanded/);
  await expect(
    strip.locator(".agenda-strip-count", { hasText: /^0$/ }),
  ).toHaveCount(0);
  const marker = strip.locator(".tnc-strip-day.is-focus .tnc-strip-num");
  const bounds = (await marker.boundingBox())!;
  expect(Math.abs(bounds.width - bounds.height)).toBeLessThan(1);
  expect(bounds.width).toBeLessThanOrEqual(32);
  const grid = (await strip.locator(".tnc-strip-grid").boundingBox())!;
  expect(grid.width).toBeLessThanOrEqual(560);
  await page.screenshot({ path: test.info().outputPath("desktop-agenda.png") });
  for (let month = 0; month < 3; month++)
    await page.getByRole("button", { name: "Next week", exact: true }).click();
  const empty = strip
    .locator(".tnc-strip-day")
    .filter({ has: page.locator(".agenda-strip-count[hidden]") })
    .nth(3);
  const date = await empty.getAttribute("data-date");
  await empty.click();
  const section = page.locator(`.tnc-list-section[data-date="${date}"]`);
  await expect(section.locator(".tnc-list-add")).toBeVisible();
  await expect(section.locator(".agenda-day-count")).toBeHidden();
  await expect(
    page.locator(".agenda-empty-range:visible").first(),
  ).toBeVisible();
  expect(
    await page.locator(".tnc-list-section[hidden]").count(),
  ).toBeGreaterThan(3);
  await page.screenshot({
    path: test.info().outputPath("agenda-empty-runs.png"),
  });
  const before = await page.locator(".tnc-list-section[data-date]").count();
  await page
    .getByRole("button", { name: "Show more days", exact: true })
    .click();
  await expect
    .poll(() => page.locator(".tnc-list-section[data-date]").count())
    .toBeGreaterThan(before);
});

test("overlapping Week and Day tasks stay separate, openable and draggable", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.clock.setFixedTime(new Date("2026-11-04T12:00:00Z"));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(upcoming);
  for (const title of ["Overlap alpha", "Overlap bravo", "Overlap charlie"]) {
    const input = page.getByRole("combobox", { name: "New task title" });
    await input.fill(`${title} tomorrow 9am`);
    await input.press("Enter");
    await expect(input).toHaveValue("");
  }
  for (const layout of ["Week", "Day"]) {
    await page.getByLabel("Calendar layout", { exact: true }).click();
    await page.getByRole("button", { name: layout, exact: true }).click();
    if (layout === "Day")
      await page
        .getByRole("button", { name: "Next period", exact: true })
        .click();
    const items = page
      .locator(".tnc-item--timed")
      .filter({ hasText: /Overlap (alpha|bravo|charlie)/ });
    await expect(items).toHaveCount(3);
    const boxes = await items.evaluateAll((elements) =>
      elements
        .map((element) => element.getBoundingClientRect().toJSON())
        .sort((left, right) => left.x - right.x),
    );
    for (let index = 1; index < boxes.length; index++)
      expect(boxes[index]!.left).toBeGreaterThanOrEqual(
        boxes[index - 1]!.right - 1,
      );
    await expect(
      page.locator(
        ".calendar-collision-trigger, .tnc-more--stack, .tnc-collision-hidden",
      ),
    ).toHaveCount(0);
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: test.info().outputPath(`${layout.toLowerCase()}-overlaps.png`),
    });
    await items.filter({ hasText: "Overlap alpha" }).click();
    const detail = page.getByRole("complementary", {
      name: "Task details",
      exact: true,
    });
    await expect(detail).toBeVisible();
    await detail.getByRole("button", { name: "Close task details" }).click();
    await expect(detail).toHaveCount(0);
  }
  const task = page
    .locator(".tnc-item--timed")
    .filter({ hasText: "Overlap alpha" });
  const start = (await task.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + 14);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, start.y + 86, { steps: 12 });
  await page.mouse.up();
  await task.click();
  await expect(
    page
      .getByRole("complementary", { name: "Task details", exact: true })
      .getByRole("button", { name: "Scheduled date", exact: true }),
  ).not.toHaveAttribute("data-value", /T09:00/);
});

test("an initially absent empty day section accepts a real pointer drop and Undo", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?demo=60");
  const source = page
    .locator('section[data-list-lane="section:overdue"] .task-row-title')
    .filter({ hasText: "Book the project room" });
  await expect(source).toBeVisible();
  const start = (await source.boundingBox())!;
  await page.mouse.move(start.x + 30, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + 30, start.y + start.height / 2 + 12, {
    steps: 3,
  });
  const target = page.locator('section[data-list-lane="section:later"]');
  await expect(target).toContainText("Drop here");
  await target.scrollIntoViewIfNeeded();
  const end = (await target.boundingBox())!;
  await page.mouse.move(end.x + end.width / 2, end.y + end.height - 20, {
    steps: 12,
  });
  await expect(target).toHaveClass(/is-drop-target/);
  await page.screenshot({
    path: test.info().outputPath("empty-group-drop.png"),
  });
  await page.mouse.up();
  await expect(source).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(source).toBeVisible();
});
