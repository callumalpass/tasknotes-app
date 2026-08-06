import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("opens and navigates the disposable demo repository", async ({ page }) => {
  await page.goto("?demo=50");

  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Prepare quarterly planning session"),
  ).toBeVisible();
  await expect(page).toHaveURL(/demo=50/);

  await page.getByRole("button", { name: "Scratchpad", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Scratchpad", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/scratchpad\?demo=50/);

  const searchButton = page.getByRole("button", {
    name: "Search",
    exact: true,
  });
  if (await searchButton.isVisible()) await searchButton.click();
  else {
    await page.getByRole("button", { name: "Views", exact: true }).click();
    await page.getByRole("menuitem", { name: "Search", exact: true }).click();
  }
  const search = page.getByRole("searchbox", { name: "Search tasks" });
  await search.fill("planning");
  await expect(
    page.getByText("Prepare quarterly planning session"),
  ).toBeVisible();
  await search.blur();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByText("TaskNotes demo")).toBeVisible();
  await expect(page.getByText("50 total")).toBeVisible();
  await expect(page).toHaveURL(/\/more\?demo=50/);
});

test("demo work screen has no serious accessibility violations", async ({
  page,
}) => {
  await page.goto("?demo=12");
  await expect(
    page.getByText("Prepare quarterly planning session"),
  ).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  expect(
    results.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
});
