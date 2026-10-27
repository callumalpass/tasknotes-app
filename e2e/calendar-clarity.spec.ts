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
    .locator(".tnc-item--list .full-calendar-event-time")
    .evaluateAll((cells) => cells.map((cell) => cell.textContent?.trim()));
  expect(times).not.toContain("All day");
  expect(times.some((time) => /\d/.test(time ?? ""))).toBe(true);
  // A due-day row whose details read "Due …" does not repeat a Due label.
  const duplicated = await page
    .locator(".tnc-item--list")
    .evaluateAll(
      (rows) =>
        rows.filter(
          (row) =>
            row.querySelector(".full-calendar-event-kind")?.textContent ===
              "Due" &&
            [
              ...row.querySelectorAll(
                ".full-calendar-event-properties > span > span",
              ),
            ].some((label) => label.textContent === "Due"),
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
  const phone = (page.viewportSize()?.width ?? 0) < 840;
  for (const id of phone ? ["calendar"] : ["upcoming", "calendar"]) {
    await page.goto(view(id));
    const modes = page.getByLabel("Calendar layout");
    await expect(modes).toBeVisible();
    const surface = (await page
      .locator(".full-calendar-surface")
      .boundingBox())!;
    const box = (await modes.boundingBox())!;
    const title = (await page
      .locator(".full-calendar-commandbar > h2")
      .boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(
      surface.x + surface.width + 1,
    );
    expect(box.y + box.height).toBeLessThanOrEqual(surface.y);
    if ((page.viewportSize()?.width ?? 0) >= 1024)
      expect(
        Math.abs(box.y + box.height / 2 - (title.y + title.height / 2)),
      ).toBeLessThan(4);
  }
});

test("the phone agenda keeps its date strip in view and overdue work on today", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The date strip is the phone agenda");
  await page.goto(view("upcoming"));
  const strip = page.locator(".tnc-strip");
  await expect(strip.getByLabel("Calendar layout")).toBeVisible();
  await expect(page.locator(".full-calendar-commandbar")).toBeHidden();
  // Demo tasks due two days ago appear under today.
  await expect(
    page
      .locator(".tnc-list-section:has(.is-today)")
      .getByText("2 days ago")
      .first(),
  ).toBeVisible();
  await page.mouse.wheel(0, 1500);
  await expect
    .poll(async () => (await strip.boundingBox())?.y ?? -1)
    .toBeGreaterThanOrEqual(0);
  await expect(strip.locator(".tnc-strip-day.is-focus")).not.toHaveClass(
    /is-today/,
  );
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
    // A neighbouring day in the same week keeps the drop on screen.
    const to = await page.evaluate((from) => {
      const cell = document.querySelector(`.tnc-dg-day[data-date="${from}"]`)!;
      return (cell.previousElementSibling ??
        cell.nextElementSibling)!.getAttribute("data-date")!;
    }, from);
    const target = page.locator(`.tnc-dg-day[data-date="${to}"]`);
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
