import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./local-test";

const view = (id: string) =>
  `views/${encodeURIComponent(`TaskNotes/Views/${id}.base#${id}`)}?demo=50`;

test("Upcoming has named, counted week days, respects the first day preference and supports keyboard selection", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "tasknotes:calendar-preferences:v1",
      JSON.stringify({ firstDay: 1 }),
    ),
  );
  await page.goto(view("upcoming"));
  // Persisting a preference makes this fixture a returning user, whose
  // one-time upgrade notice otherwise covers the sticky strip on phones.
  await page
    .getByRole("complementary", { name: "mdbase update" })
    .getByRole("button", { name: "Dismiss" })
    .click();
  const strip = page.locator(".tnc-strip");
  const days = strip.locator(".tnc-strip-day");
  await expect(days).toHaveCount(7);
  const first = await days.first().getAttribute("data-date");
  expect(new Date(`${first}T12:00:00`).getDay()).toBe(1);
  const today = strip.locator('.tnc-strip-day[aria-current="date"]');
  await expect(today).toHaveAttribute("aria-label", /\d+ tasks?$/);
  const date = await today.getAttribute("data-date");
  const group = page.locator(`.tnc-list-section[data-date="${date}"]`);
  await expect(group.getByRole("heading")).toContainText("Today ·");
  const count = await group
    .locator(".tnc-item--list:not(.is-time-entry)")
    .count();
  await expect(group.locator(".agenda-day-count")).toHaveText(String(count));
  await expect(today.locator(".agenda-strip-count")).toHaveText(String(count));
  const leadIds = await page
    .locator(".tnc-list-lead .tnc-item")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-id")));
  expect(
    await group
      .locator(".tnc-item")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-id")),
      ),
  ).not.toEqual(expect.arrayContaining([leadIds[0]]));
  await today.focus();
  await page.keyboard.press("ArrowRight");
  const focused = strip.locator(".tnc-strip-day:focus");
  const selectedDate = await focused.getAttribute("data-date");
  await page.keyboard.press("Enter");
  await expect(
    strip.locator(`.tnc-strip-day[data-date="${selectedDate}"]`),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.locator(
      `.tnc-list-section[data-date="${selectedDate}"] .tnc-list-day`,
    ),
  ).toBeInViewport();
  await page.getByRole("button", { name: "Next week", exact: true }).click();
  expect(await days.first().getAttribute("data-date")).not.toBe(first);
  await page
    .getByRole("button", { name: "Previous week", exact: true })
    .click();
  await expect(days.first()).toHaveAttribute("data-date", first!);
  const accessibility = await new AxeBuilder({ page })
    .include(".full-calendar-view")
    .analyze();
  expect(accessibility.violations).toEqual([]);
});

test("an empty agenda day creates a saved task on that day", async ({
  page,
  isMobile,
}) => {
  await page.goto(view("upcoming"));
  const strip = page.locator(".tnc-strip");
  for (let week = 0; week < 4; week++)
    await page.getByRole("button", { name: "Next week", exact: true }).click();
  const day = strip
    .locator(".tnc-strip-day")
    .filter({ has: page.locator(".agenda-strip-count", { hasText: /^0$/ }) })
    .first();
  const date = await day.getAttribute("data-date");
  await day.click();
  const section = page.locator(`.tnc-list-section[data-date="${date}"]`);
  await expect(section).toHaveClass(/is-empty/);
  await expect(section.locator(".agenda-day-count")).toHaveText("0");
  await section.getByRole("button", { name: /^Add task,/ }).click();
  const capture = isMobile
    ? page.getByRole("dialog", { name: "New task" })
    : page.locator(".view-detail > .capture-composer");
  const input = capture.getByRole("combobox", { name: "New task title" });
  await expect(input).toBeFocused();
  await input.fill("Empty day capture regression");
  if (isMobile)
    await capture.getByRole("button", { name: "Add", exact: true }).click();
  else await input.press("Enter");
  await expect(
    section.getByRole("button", {
      name: "Empty day capture regression",
      exact: true,
    }),
  ).toBeVisible();
  await expect(section.locator(".agenda-day-count")).toHaveText("1");
});

test("desktop agenda tasks drag onto a week-strip day without opening details", async ({
  page,
  isMobile,
}) => {
  test.skip(
    isMobile,
    "Pointer drag is exercised on desktop; phones retain the calendar touch gesture",
  );
  await page.goto(view("upcoming"));
  const source = page
    .locator(".tnc-list-lead")
    .getByRole("button", { name: "Book the project room", exact: true });
  const target = page
    .locator(".tnc-strip-day[aria-current=date]")
    .locator("xpath=following-sibling::button[1]");
  const date = await target.getAttribute("data-date");
  await source.scrollIntoViewIfNeeded();
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + from.height / 2 + 10, {
    steps: 3,
  });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 10,
  });
  await page.mouse.up();
  await expect(source).toHaveCount(0);
  const section = page.locator(`.tnc-list-section[data-date="${date}"]`);
  await expect(
    section.getByRole("button", { name: "Book the project room", exact: true }),
  ).toBeAttached();
  await expect(
    page.getByRole("complementary", { name: "Task details" }),
  ).toHaveCount(0);
});

test.describe("calendar drops", () => {
  test.skip(({ isMobile }) => isMobile, "Phone months draw indicator dots");

  test("a dropped task never returns to its old day before settling", async ({
    page,
  }) => {
    await page.goto(view("calendar"));
    const event = page
      .locator(".tnc-dg .tnc-item.is-draggable")
      .filter({ hasText: /\S/ })
      .first();
    await expect(event).toBeVisible();
    const title = (await event
      .locator(".full-calendar-event-primary > span")
      .last()
      .textContent())!.trim();
    const from = (await event.getAttribute("data-date"))!;
    // The quietest other day in the same week keeps the drop on screen
    // rather than behind its "+N more". A full day renders only what fits, so
    // its overflow button counts too; and a neighbour alone is not enough,
    // since today can open the week beside an equally full day.
    const to = await page.evaluate((from) => {
      const cell = document.querySelector(`.tnc-dg-day[data-date="${from}"]`)!;
      const week = cell.closest(".tnc-dg-week")!;
      const load = (day: Element) => {
        const { left, right } = day.getBoundingClientRect();
        const hidden = [...week.querySelectorAll(".tnc-more")]
          .filter((more) => {
            const { x } = more.getBoundingClientRect();
            return x >= left && x < right;
          })
          .reduce((sum, more) => sum + parseInt(more.textContent!.slice(1)), 0);
        return (
          hidden +
          week.querySelectorAll(
            `.tnc-item[data-date="${day.getAttribute("data-date")}"]`,
          ).length
        );
      };
      const [quietest] = [...week.querySelectorAll(".tnc-dg-day")]
        .filter((day) => day !== cell)
        .sort((a, b) => load(a) - load(b));
      return quietest!.getAttribute("data-date")!;
    }, from);
    const target = page.locator(`.tnc-dg-day[data-date="${to}"]`);
    // The first draggable task can sit in a week below the fold; the mouse
    // only reaches what is on screen.
    await target.scrollIntoViewIfNeeded();
    await page.evaluate(
      ({ title }) => {
        const seen: string[] = [];
        (window as unknown as { __calendarDays: string[] }).__calendarDays =
          seen;
        new MutationObserver(() => {
          for (const node of document.querySelectorAll<HTMLElement>(
            ".tnc-dg .tnc-item",
          ))
            if (
              node.textContent?.includes(title) &&
              !node.classList.contains("is-dragging") &&
              getComputedStyle(node).visibility !== "hidden"
            )
              seen.push(node.dataset.date ?? "");
        }).observe(document.querySelector(".tnc")!, {
          subtree: true,
          childList: true,
          attributes: true,
        });
      },
      { title },
    );
    // The mouse does not scroll, so bring the week on screen first.
    await event.scrollIntoViewIfNeeded();
    const start = (await event.boundingBox())!;
    const end = (await target.boundingBox())!;
    await page.mouse.move(start.x + 20, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(start.x + 20, start.y + start.height / 2 + 10, {
      steps: 3,
    });
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
      steps: 10,
    });
    await page.evaluate(() => {
      (
        window as unknown as { __calendarDays: string[] }
      ).__calendarDays.length = 0;
    });
    await page.mouse.up();
    await expect(
      page.locator(`.tnc-dg .tnc-item[data-date="${to}"]`, {
        hasText: title,
      }),
    ).toBeVisible();
    await page.waitForTimeout(500);
    const days = await page.evaluate(
      () => (window as unknown as { __calendarDays: string[] }).__calendarDays,
    );
    expect(days).not.toContain(from);
  });
});
