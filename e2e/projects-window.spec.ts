import { expect, test } from "./local-test";

test("Projects windows 125 groups and keeps offscreen jumps and row navigation", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(
    `views/${encodeURIComponent("TaskNotes/Views/projects.base#projects")}?demo=projects-scale`,
  );
  const project = (number: string) =>
    page.getByRole("button", {
      name: `Project ${number} 80 tasks`,
      exact: true,
    });
  const task = (name: string) =>
    page.getByRole("button", { name: `Task ${name}`, exact: true });
  const rows = page.locator(".project-group .task-row");
  await expect(task("001-01")).toBeVisible({ timeout: 30_000 });
  expect(await rows.count()).toBeLessThan(100);
  await expect(project("125")).toHaveCount(0);

  const jump = page.getByRole("combobox", { name: "Jump to project" });
  await jump.click();
  await page
    .getByRole("option", { name: "Project 125 (80)", exact: true })
    .click();
  const last = project("125");
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();
  const controlsId = await last.getAttribute("aria-controls");
  expect(controlsId).toMatch(/^\S+$/);
  const controlled = page.locator(`[id="${controlsId}"]`);
  await expect(
    controlled.getByRole("button", { name: "Task 125-01", exact: true }),
  ).toBeVisible();
  await last.press("Enter");
  await expect(last).toHaveAttribute("aria-expanded", "false");
  await expect(controlled).toBeHidden();
  await last.press("Enter");
  await expect(last).toHaveAttribute("aria-expanded", "true");
  await expect(task("125-01")).toBeVisible();

  await task("125-01").focus();
  await task("125-01").press("ArrowUp");
  await expect(task("124-80")).toBeFocused();
  await task("124-80").press("Shift+ArrowDown");
  await expect(task("125-01")).toBeFocused();
  await expect(page.locator(".bulk-actions")).toContainText("2 selected");
  await page.keyboard.press("Escape");

  // A retained row must navigate to its true neighbour after a long scroll.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(task("001-01")).toBeInViewport();
  await expect(task("125-02")).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await expect(task("125-02")).toBeFocused();
  await expect(task("125-02")).toBeInViewport();
  expect(await rows.count()).toBeLessThan(100);

  await task("125-02").press("Enter");
  await expect(page.getByRole("textbox", { name: "Task title" })).toHaveValue(
    "Task 125-02",
  );
  await page.getByRole("button", { name: "Next task", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Task title" })).toHaveValue(
    "Task 125-03",
  );
});
