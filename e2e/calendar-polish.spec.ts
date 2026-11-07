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
  await expect
    .poll(async () =>
      Math.abs(
        (await section.boundingBox())!.y -
          (await strip.boundingBox())!.y -
          (await strip.boundingBox())!.height,
      ),
    )
    .toBeLessThan(3);
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
  const populated = page
    .locator(".tnc-list-section:not([hidden])")
    .filter({ has: page.locator(".agenda-day-count:not([hidden])") });
  await expect
    .poll(() =>
      populated.evaluateAll((days) =>
        days
          .filter((day) => {
            const slots = [...day.querySelectorAll(".agenda-task-slot")];
            return (
              slots.length === 0 ||
              slots.some(
                (slot) => slot.querySelectorAll(".task-row-title").length !== 1,
              )
            );
          })
          .map((day) => day.getAttribute("data-date")),
      ),
    )
    .toEqual([]);
  const before = await page.locator(".tnc-list-section[data-date]").count();
  await page
    .getByRole("button", { name: "Show more days", exact: true })
    .click();
  await expect
    .poll(() => page.locator(".tnc-list-section[data-date]").count())
    .toBeGreaterThan(before);
});

test("overlapping Week and Day tasks stay readable, openable and draggable", async ({
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
    for (const box of boxes) expect(box.width).toBeGreaterThanOrEqual(100);
    for (let index = 1; index < boxes.length; index++) {
      if (layout === "Day")
        expect(boxes[index]!.left).toBeGreaterThanOrEqual(
          boxes[index - 1]!.right - 1,
        );
      else expect(boxes[index]!.left).toBeGreaterThan(boxes[index - 1]!.left);
    }
    await expect(
      page.locator(
        ".calendar-collision-trigger, .tnc-more--stack, .tnc-collision-hidden",
      ),
    ).toHaveCount(0);
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: test.info().outputPath(`${layout.toLowerCase()}-overlaps.png`),
    });
    await items
      .filter({ hasText: "Overlap alpha" })
      .click({ position: { x: 4, y: 14 } });
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
  await task.hover();
  const start = (await task.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + 14);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, start.y + 86, { steps: 12 });
  await page.mouse.up();
  await task.click();
  const scheduled = page
    .getByRole("complementary", { name: "Task details", exact: true })
    .getByRole("button", { name: "Scheduled date", exact: true });
  await expect(scheduled).toHaveAttribute("data-value", "2026-11-05");
  await expect(scheduled).toContainText("10:00");
});

test("one to five simultaneous tasks keep readable titles and keyboard access", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.clock.setFixedTime(new Date("2026-11-04T12:00:00Z"));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(upcoming);
  const titles = [
    "Alpha planning",
    "Bravo research",
    "Charlie writing",
    "Delta review",
    "Echo release",
  ];
  for (let count = 1; count <= 5; count++) {
    if (count > 1) {
      await page.getByLabel("Calendar layout", { exact: true }).click();
      await page.getByRole("button", { name: "Agenda", exact: true }).click();
    }
    const input = page.getByRole("combobox", { name: "New task title" });
    await input.fill(
      `${titles[count - 1]} tomorrow 1pm ${count === 1 ? "45m" : count === 5 ? "30m" : "60m"}`,
    );
    await input.press("Enter");
    await expect(input).toHaveValue("");
    await page.getByLabel("Calendar layout", { exact: true }).click();
    await page.getByRole("button", { name: "Week", exact: true }).click();
    const items = page.locator(".tnc-item--timed").filter({
      hasText:
        /Alpha planning|Bravo research|Charlie writing|Delta review|Echo release/,
    });
    await expect(items).toHaveCount(count);
    const lane = items.first().locator("xpath=..");
    const overlapStart = (await items.first().boundingBox())!.y;
    expect(
      await lane.locator(".tnc-item--timed").evaluateAll(
        (elements, top) =>
          elements.filter((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.top <= top + 1 && bounds.bottom > top + 1;
          }).length,
        overlapStart,
      ),
    ).toBe(count);
    for (const item of await items.all()) {
      expect((await item.boundingBox())!.width).toBeGreaterThanOrEqual(100);
      expect(
        await item
          .locator(".full-calendar-event-primary > span")
          .evaluate((el) => getComputedStyle(el).overflowWrap),
      ).toBe("normal");
      await item.focus();
      await expect(item).toBeFocused();
      await expect(page.getByRole("tooltip")).toContainText(
        await item.locator(".full-calendar-event-primary").innerText(),
      );
    }
    await page.getByLabel("Calendar layout", { exact: true }).focus();
    await page.mouse.move(0, 0);
    const exposed = await items.evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        const visibleWidth = elements.reduce((width, sibling) => {
          const other = sibling.getBoundingClientRect();
          return other.left > bounds.left && other.top < bounds.top + 40
            ? Math.min(width, other.left - bounds.left)
            : width;
        }, bounds.width);
        return {
          visibleWidth,
          visibility: getComputedStyle(
            element.querySelector(".full-calendar-event-content")!,
          ).visibility,
          label: element.getAttribute("aria-label"),
        };
      }),
    );
    for (const entry of exposed) {
      expect(entry.label).toBeTruthy();
      expect(entry.visibility).toBe(
        entry.visibleWidth < 48 ? "hidden" : "visible",
      );
    }
    if (count >= 4)
      expect(
        exposed.filter((entry) => entry.visibility === "hidden"),
      ).toHaveLength(count - 1);
    await page.screenshot({
      path: test.info().outputPath(`week-${count}-overlaps.png`),
    });
  }
  const short = page.locator(
    '.tnc-item--timed[data-id="scheduled-demo-planning-session"]',
  );
  await expect(short).toBeVisible();
  await expect(short.locator(".full-calendar-event-secondary")).toBeHidden();
  const tracked = page.locator(".tnc-item--timed.is-time-entry");
  await expect(tracked).toBeVisible();
  await expect(tracked.locator("xpath=..")).toHaveClass(/tnc-col-actual/);
  await expect(tracked.locator(".full-calendar-event-secondary")).toBeHidden();
  const trackedBounds = (await tracked.boundingBox())!;
  const planned = tracked
    .locator("xpath=../..")
    .locator(".tnc-col-plan .tnc-item--timed");
  for (const item of await planned.all()) {
    const bounds = (await item.boundingBox())!;
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(trackedBounds.x);
  }
  const secondary = await page
    .locator(".tnc-item--timed .full-calendar-event-secondary:visible")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        top: element.getBoundingClientRect().top,
        titleBottom:
          element.previousElementSibling!.getBoundingClientRect().bottom,
      })),
    );
  for (const bounds of secondary)
    expect(bounds.top).toBeGreaterThanOrEqual(bounds.titleBottom);
  const halfHour = page
    .locator(".tnc-item--timed")
    .filter({ hasText: "Echo release" });
  expect((await halfHour.boundingBox())!.height).toBeLessThanOrEqual(44);
  await expect(halfHour.locator(".full-calendar-event-secondary")).toBeHidden();
  const reveal = page
    .locator(".tnc-item--timed")
    .filter({ hasText: "Alpha planning" });
  await reveal.hover({ position: { x: 4, y: 14 } });
  await expect(page.getByRole("tooltip")).toContainText("Alpha planning");
  await page.screenshot({
    path: test.info().outputPath("week-5-revealed.png"),
  });
  await page.mouse.move(0, 0);
  await page.locator(".tnc-tg-top .tnc-more:visible").first().click();
  await expect(page.locator(".tnc-popover")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".tnc-popover")).toHaveCount(0);
  const start = (await reveal.boundingBox())!;
  await page.mouse.move(start.x + 4, start.y + 14);
  await page.mouse.down();
  await page.mouse.move(start.x + 4, start.y + 86, { steps: 12 });
  await page.mouse.up();
  await reveal.click();
  const scheduled = page
    .getByRole("complementary", { name: "Task details", exact: true })
    .getByRole("button", { name: "Scheduled date", exact: true });
  await expect(scheduled).toHaveAttribute("data-value", "2026-11-05");
  await expect(scheduled).toContainText("2:00 PM");
});

for (const width of [1440, 390]) {
  test(`agenda add controls take no extra height and remain keyboard reachable at ${width}px`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date("2026-11-04T12:00:00Z"));
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(upcoming);
    await page.mouse.move(0, 0);
    const today = page.locator(
      '.tnc-list-section[data-date="2026-11-04"] .tnc-list-add',
    );
    await expect(today).toHaveCSS("opacity", "1");
    const tomorrow = page.locator(
      '.tnc-list-section[data-date="2026-11-05"] .tnc-list-add',
    );
    await expect(tomorrow).toHaveCSS("opacity", "0");
    await expect(tomorrow).toHaveCSS("position", "absolute");
    const sections = page.locator(
      ".tnc-list-section[data-date]:not(.is-add-day):not([hidden]):not(.is-empty-range)",
    );
    expect(await sections.count()).toBeGreaterThan(0);
    for (const section of await sections.all()) {
      const extraHeight = await section.evaluate((element) => {
        const button = element.querySelector<HTMLElement>(".tnc-list-add")!;
        const before = element.getBoundingClientRect().height;
        button.style.display = "none";
        const without = element.getBoundingClientRect().height;
        button.style.removeProperty("display");
        return before - without;
      });
      expect(extraHeight).toBe(0);
    }
    const section = tomorrow.locator("xpath=..");
    await section.scrollIntoViewIfNeeded();
    const before = (await section.boundingBox())!;
    await section.hover();
    await expect(tomorrow).toHaveCSS("opacity", "1");
    expect((await section.boundingBox())!.height).toBe(before.height);
    await page.mouse.move(0, 0);
    await tomorrow.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(tomorrow).toBeFocused();
    await expect(tomorrow).toHaveCSS("opacity", "1");
    expect((await section.boundingBox())!.height).toBe(before.height);
    await expect(tomorrow).toHaveAccessibleName(/Add task/);
    if (width === 390) {
      expect((await tomorrow.boundingBox())!.width).toBe(44);
      expect((await tomorrow.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(
        (await section.locator(".tnc-list-day").boundingBox())!.height,
      ).toBeLessThanOrEqual(60);
    }
    await page.screenshot({
      path: test.info().outputPath(`agenda-add-focus-${width}.png`),
    });
    await page.keyboard.press("Enter");
    const input = page.getByRole("combobox", { name: "New task title" });
    await expect(input).toBeFocused();
    await input.fill("Keyboard agenda addition");
    await input.press("Enter");
    await expect(
      page
        .locator('.tnc-list-section[data-date="2026-11-05"]')
        .getByRole("button", { name: "Keyboard agenda addition", exact: true }),
    ).toBeVisible();
  });
}

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
