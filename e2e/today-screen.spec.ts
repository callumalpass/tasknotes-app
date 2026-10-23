import { expect, test } from "./local-test";

// Disposable in-memory demo only: never opens a Connect authority or LAB.
const section = (page: import("@playwright/test").Page, name: string) =>
  page.locator("section.task-section").filter({
    has: page.getByRole("button", { name: new RegExp(`^${name} \\d+$`) }),
  });

test("moves overdue work to today from the Overdue heading, with Undo", async ({
  page,
}) => {
  await page.goto("?demo=12");
  const move = page.getByRole("button", {
    name: "Move all to today, 4 overdue tasks",
  });
  await move.focus();
  await page.keyboard.press("Enter");

  // Manual order keeps the emptied section as a drop destination.
  await expect(
    page.getByRole("button", { name: "Overdue 0", exact: true }),
  ).toBeVisible();
  await expect(move).toHaveCount(0);
  await expect(
    section(page, "Today").getByText("Confirm next week’s interviews"),
  ).toBeVisible();
  // A kept time later today still belongs to Today.
  await expect(
    section(page, "Today").getByText("Prepare quarterly planning session"),
  ).toBeVisible();
  const undo = page.getByRole("button", { name: "Undo" });
  await expect(
    page.getByText("Moved 4 tasks to today", { exact: true }),
  ).toBeVisible();
  await expect(undo).toBeFocused();

  await undo.click();
  await expect(
    page.getByRole("button", { name: "Overdue 4", exact: true }),
  ).toBeVisible();
  await expect(
    section(page, "Overdue").getByText("Confirm next week’s interviews"),
  ).toBeVisible();
  await expect(
    page.getByText("Moved 4 tasks to today", { exact: true }),
  ).toHaveCount(0);
});

test("a finished day says Today is clear and leads to Upcoming", async ({
  page,
}) => {
  await page.goto("?demo=12");
  await expect(
    page.getByRole("button", { name: "Overdue 4", exact: true }),
  ).toBeVisible();
  // The demo has an extra Today occurrence on MO/WE/FR. Count the planned
  // tasks before completing anything; overdue work is not part of this total.
  const plannedTasks = section(page, "Today").getByRole("button", {
    name: /^Complete /,
  });
  await expect(plannedTasks.first()).toBeVisible();
  const plannedToday = await plannedTasks.count();
  // Progress is intentionally hidden until the first planned task is done.
  await expect(page.locator(".view-date")).not.toContainText(/\d+ of \d+ done/);
  for (const name of ["Today", "Overdue"]) {
    const rows = section(page, name).getByRole("button", {
      name: /^Complete /,
    });
    while (await rows.count()) {
      await rows.first().click();
      await page.waitForTimeout(150);
    }
  }
  await expect(page.getByText("Today is clear")).toBeVisible();
  await expect(page.locator(".view-date")).toContainText(
    `· ${plannedToday} of ${plannedToday} done`,
  );
  await expect(page.locator(".today-clear")).toContainText(/^Today is clear/);
  await expect(page.locator(".today-clear")).toContainText("Next:");
  await page.getByRole("button", { name: "See Upcoming" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Upcoming" }),
  ).toBeVisible();
});

test("the phone Add task button narrows while scrolling and clears the last row", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The floating Add task button is phone-only.");
  await page.goto("?demo=50");
  const fab = page.locator(".view-context-capture");
  await expect(fab).toContainText("Add task");
  const wide = (await fab.boundingBox())!.width;

  await page.mouse.move(200, 400);
  for (let step = 0; step < 4; step += 1) {
    await page.evaluate(() => window.scrollBy(0, 80));
    await page.waitForTimeout(30);
  }
  await expect(fab).toHaveClass(/is-collapsed/);
  await expect(fab).toHaveAccessibleName("New task");
  await expect
    .poll(async () => (await fab.boundingBox())!.width)
    .toBeLessThan(wide);
  // Settling restores the label.
  await expect(fab).not.toHaveClass(/is-collapsed/, { timeout: 2_000 });

  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await expect(fab).not.toHaveClass(/is-collapsed/, { timeout: 2_000 });
  const lastMenu = page.locator(".task-actions-trigger").last();
  const menuBox = (await lastMenu.boundingBox())!;
  const fabBox = (await fab.boundingBox())!;
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(fabBox.y);
});
