import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./local-test";

test.use({ timezoneId: "UTC", reducedMotion: "reduce" });

test("a dense agenda keeps day totals, row focus and collapse while scrolling", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.clock.setFixedTime(new Date("2026-11-04T12:00:00Z"));
  await page.goto(
    "views/TaskNotes%2FViews%2Fupcoming.base%23upcoming?demo=10000",
  );
  const lead = page.locator(".tnc-list-lead");
  const groups = lead.locator(".agenda-row-group");
  const toggle = lead.getByRole("button", { name: /^Overdue \d+$/ });
  const titles = page.locator(".tnc-item--list .task-row-title");
  // Cold admission seeds 10k records before the calendar can mount a pool.
  await expect(groups.first().locator(".task-row-title").first()).toBeVisible({
    timeout: 30_000,
  });
  expect(await groups.count()).toBeGreaterThan(100);
  expect(await titles.count()).toBeLessThan(160);

  // Cross the boundary between two native pools using the normal row shortcuts.
  const end = groups.first().locator(".task-row-title").last();
  await groups.first().scrollIntoViewIfNeeded();
  await end.focus();
  await end.press("ArrowDown");
  const next = groups.nth(1).locator(".task-row-title").first();
  await expect(next).toBeFocused();
  await next.press("ArrowUp");
  await expect(end).toBeFocused();

  // A user may scroll while keyboard focus stays on the earlier task.
  const far = groups.nth(80);
  await far.scrollIntoViewIfNeeded();
  await expect(far.locator(".task-row-title").first()).toBeVisible();
  await expect(end).toBeFocused();
  expect(await titles.count()).toBeLessThan(160);
  // Arrow navigation still follows the pinned task, even while the next
  // logical group is outside the viewport and has released its native rows.
  await expect(next).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await expect(next).toBeFocused();
  await far.scrollIntoViewIfNeeded();
  await far.locator(".task-row-title").first().focus();
  await expect(groups.first().locator(".tnc-item")).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(lead.locator(".tnc-list-rows")).toBeHidden();
  const today = page.locator(".tnc-strip-day[aria-current=date]");
  const total = Number(
    await today.locator(".agenda-strip-count").textContent(),
  );
  const date = await today.getAttribute("data-date");
  await today.click();
  const section = page.locator(`.tnc-list-section[data-date="${date}"]`);
  await expect(section.locator(".agenda-day-count")).toHaveText(String(total));
  await expect(section.locator(".task-row-title").first()).toBeVisible();
  expect(await section.locator(".task-row-title").count()).toBeLessThan(total);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(lead.locator(".task-row-title").first()).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include(".full-calendar-view").analyze())
      .violations,
  ).toEqual([]);
});
