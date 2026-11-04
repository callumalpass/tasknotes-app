import { expect, test } from "@playwright/test";

test.skip(({ isMobile }) => !isMobile, "These are phone layouts.");

test("a strip day lands with its first task under the headings", async ({
  page,
}) => {
  await page.goto(
    `views/${encodeURIComponent("TaskNotes/Views/upcoming.base#upcoming")}?demo=60`,
  );
  const strip = page.locator(".tnc-strip");
  await expect(strip).toBeVisible();
  await page.locator(".tnc-strip-day").nth(4).tap();
  await expect
    .poll(() =>
      page.locator(".tnc-list-section .tnc-list-day").evaluateAll((days) => {
        const stripBottom = document
          .querySelector(".tnc-strip")!
          .getBoundingClientRect().bottom;
        const day = days.find(
          (day) =>
            day.getBoundingClientRect().top >= stripBottom &&
            day.parentElement!.querySelector(".task-row"),
        )!;
        const row = day.parentElement!.querySelector(".task-row")!;
        return (
          row.getBoundingClientRect().top - day.getBoundingClientRect().bottom
        );
      }),
    )
    .toBeGreaterThanOrEqual(0);
});

test("the agenda controls share one line", async ({ page }) => {
  await page.goto(
    `views/${encodeURIComponent("TaskNotes/Views/upcoming.base#upcoming")}?demo=60`,
  );
  const head = page.locator(".tnc-strip-head");
  await expect(head).toBeVisible();
  expect((await head.boundingBox())!.height).toBeLessThanOrEqual(64);
});

test("tapping a month day brings its tasks into view", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto(
    `views/${encodeURIComponent("TaskNotes/Views/calendar.base#calendar")}?demo=60`,
  );
  await expect(page.locator(".tnc-dg-day").first()).toBeVisible();
  await page.locator(".tnc-dg-day").nth(25).tap();
  const list = page.getByRole("complementary", { name: "Selected day" });
  await expect(list).toBeVisible();
  await expect(list.locator("h2")).toBeInViewport();
});
