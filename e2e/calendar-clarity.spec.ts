import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./local-test";

const view = (id: string) =>
  `views/${encodeURIComponent(`TaskNotes/Views/${id}.base#${id}`)}?demo=50`;

test("calendar names elevated priority and keeps entries accessible", async ({
  page,
}) => {
  await page.goto(view("calendar"));
  await expect(page.locator(".tnc-dg .tnc-item").first()).toBeVisible();
  await expect(page.getByRole("list", { name: "Calendar markers" })).toHaveText(
    "High priority",
  );
  const accessibility = await new AxeBuilder({ page })
    .include(".full-calendar-view")
    .analyze();
  expect(accessibility.violations).toEqual([]);
  const phone = (page.viewportSize()?.width ?? 0) < 840;
  if (phone) {
    // Phone months draw every task as a dot; only elevated ones are coloured.
    await expect(
      page.locator(".tnc-dg-dots .tnc-item--indicator.has-marker").first(),
    ).toBeAttached();
    return;
  }
  const marked = page
    .locator(".tnc-item:has(.full-calendar-event-content.has-marker)")
    .first();
  await expect(marked).toHaveAttribute("title", "High priority");
  await expect(marked).toHaveAttribute("aria-label", /high priority$/);
  const unmarked = page
    .locator(".tnc-dg .tnc-item .full-calendar-event-content:not(.has-marker)")
    .first();
  await expect(unmarked.locator("i")).toHaveCount(0);
});

test("agenda groups all-day tasks under the date and labels only timed ones", async ({
  page,
}) => {
  await page.goto(view("upcoming"));
  await expect(page.locator(".tnc-item--list").first()).toBeVisible();
  const times = await page
    .locator(".tnc-item--list .task-row-context")
    .evaluateAll((cells) => cells.map((cell) => cell.textContent?.trim()));
  expect(times).not.toContain("All day");
  await expect(page.locator(".tnc-item--list .task-row").first()).toBeVisible();
  await expect(page.locator(".tnc-item--list[role=button]")).toHaveCount(0);
  await expect(
    page.locator(".tnc-item--list .tnc-item-main").first(),
  ).toHaveCSS("display", "block");
  expect(times.some((time) => /\d/.test(time ?? ""))).toBe(true);
  // A due-day row whose details read "Due …" does not repeat a Due label.
  const duplicated = await page
    .locator(".tnc-item--list")
    .evaluateAll(
      (rows) =>
        rows.filter(
          (row) =>
            row.querySelector(".task-row-context")?.textContent === "Due" &&
            [...row.querySelectorAll(".task-row-property > span")].some(
              (label) => label.textContent === "Due",
            ),
        ).length,
    );
  expect(duplicated).toBe(0);
  await expect(
    page.locator(".tnc-list .full-calendar-event-primary > i"),
  ).toHaveCount(0);
});

test("the layout switcher sits on the date row above the calendar on both screens", async ({
  page,
}) => {
  // Phone agendas keep the switcher in their date strip instead.
  for (const id of ["calendar"]) {
    await page.goto(view(id));
    const modes = page.getByLabel("Calendar layout");
    await expect(modes).toBeVisible();
    const surface = (await page
      .locator(".full-calendar-surface")
      .boundingBox())!;
    const box = (await modes.boundingBox())!;
    // Beside the day list the range takes its own line; the switcher stays
    // on the row with the date navigation either way.
    const navigation = (await page
      .locator(".full-calendar-navigation")
      .boundingBox())!;
    const title = (await page
      .locator(".full-calendar-commandbar > h2")
      .boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(
      surface.x + surface.width + 1,
    );
    expect(box.y + box.height).toBeLessThanOrEqual(surface.y);
    expect(title.y + title.height).toBeLessThanOrEqual(surface.y);
    if ((page.viewportSize()?.width ?? 0) >= 1024)
      expect(
        Math.abs(
          box.y + box.height / 2 - (navigation.y + navigation.height / 2),
        ),
      ).toBeLessThan(4);
  }
});

test("the agenda keeps its strip in view and moves overdue work to today", async ({
  page,
}) => {
  await page.goto(view("upcoming"));
  const strip = page.locator(".tnc-strip");
  const commands = page.locator(".full-calendar-commandbar");
  await expect(commands.getByLabel("Calendar layout")).toBeVisible();
  await expect(commands).toBeVisible();
  await page
    .locator(".tnc-list-section[data-date]")
    .nth(2)
    .scrollIntoViewIfNeeded();
  await expect
    .poll(async () => (await strip.boundingBox())?.y ?? -1)
    .toBeGreaterThanOrEqual(0);
  await expect(strip.locator(".tnc-strip-day.is-focus")).not.toHaveClass(
    /is-today/,
  );
  // Today returns to the top, where overdue work waits above today.
  await commands.getByRole("button", { name: "Today", exact: true }).click();
  const overdue = page.locator(".tnc-list-lead");
  await expect(overdue.getByText("2 days ago").first()).toBeVisible();
  // As in the Today view, Scheduled moves to today and Due stays the
  // deadline, so only work overdue by Due stays listed here.
  const items = overdue.locator(".tnc-item");
  const before = await items.count();
  const move = overdue.getByRole("button", {
    name: /^Move all to today, \d+ overdue tasks?$/,
  });
  await move.click();
  await page.getByRole("button", { name: "Move due dates too" }).click();
  await expect(page.locator(".undo-toast")).toContainText("to today");
  await expect.poll(() => items.count()).toBeLessThan(before);
  await expect(move).toHaveCount(0);
  await page
    .locator(".undo-toast")
    .getByRole("button", { name: "Undo" })
    .click();
  await expect.poll(() => items.count()).toBe(before);
});

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
  const count = await group.locator(".tnc-item--list").count();
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
  const header = page.locator(
    `.tnc-list-section[data-date="${selectedDate}"] .tnc-list-day`,
  );
  const stripBox = (await strip.boundingBox())!;
  const headerBox = (await header.boundingBox())!;
  expect(headerBox.y).toBeGreaterThanOrEqual(stripBox.y + stripBox.height - 1);
  await page.getByRole("button", { name: "Next period", exact: true }).click();
  expect(await days.first().getAttribute("data-date")).not.toBe(first);
  await page
    .getByRole("button", { name: "Previous period", exact: true })
    .click();
  await expect(days.first()).toHaveAttribute("data-date", first!);
  const accessibility = await new AxeBuilder({ page })
    .include(".full-calendar-view")
    .analyze();
  expect(accessibility.violations).toEqual([]);
});

test("every calendar layout remains available from the compact disclosure", async ({
  page,
}) => {
  await page.goto(view("upcoming"));
  for (const [label, mode] of [
    ["Month", "month"],
    ["Week", "week"],
    ["3 days", "days"],
    ["Day", "day"],
    ["Year", "year"],
    ["Agenda", "list"],
  ]) {
    await page.getByLabel("Calendar layout", { exact: true }).click();
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.locator(`.tnc--${mode}`)).toBeVisible();
  }
});

test("an empty agenda day stays compact and creates a task on that day", async ({
  page,
  isMobile,
}) => {
  await page.goto(view("upcoming"));
  const strip = page.locator(".tnc-strip");
  for (let week = 0; week < 4; week++)
    await page.getByRole("button", { name: "Next period", exact: true }).click();
  const day = strip
    .locator(".tnc-strip-day")
    .filter({ has: page.locator(".agenda-strip-count", { hasText: /^0$/ }) })
    .first();
  const date = await day.getAttribute("data-date");
  await day.click();
  const section = page.locator(`.tnc-list-section[data-date="${date}"]`);
  await expect(section).toHaveClass(/is-empty/);
  await expect(section.locator(".agenda-day-count")).toHaveText("0");
  expect((await section.boundingBox())!.height).toBeLessThan(130);
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
