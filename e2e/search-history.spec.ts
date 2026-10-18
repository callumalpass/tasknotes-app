import { expect, test } from "./local-test";

test("Search offers recent searches and recently opened tasks", async ({
  page,
}) => {
  await page.goto("search?demo=50");
  const search = page.getByRole("searchbox", { name: "Search tasks" });
  await expect(
    page.getByRole("button", { name: "Field research" }),
  ).toBeVisible();
  await expect(page.getByText("Recent searches")).toHaveCount(0);
  await expect(page.getByText("Recently opened")).toHaveCount(0);

  await search.fill("planning");
  const result = page.getByText("Prepare quarterly planning session");
  await expect(result).toBeVisible();
  await result.click();
  await expect(
    page.getByRole("textbox", { name: "Task title", exact: true }),
  ).toHaveValue("Prepare quarterly planning session");

  await page.goto("search?demo=50");
  const searches = page.getByRole("region", { name: "Recent searches" });
  await expect(
    searches.getByRole("button", { name: "planning" }),
  ).toBeVisible();
  const opened = page.getByRole("region", { name: "Recently opened" });
  await opened
    .getByRole("button", { name: "Prepare quarterly planning session" })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Task title", exact: true }),
  ).toHaveValue("Prepare quarterly planning session");

  await page.goto("search?demo=50");
  await page.getByRole("button", { name: "Clear recent searches" }).click();
  await expect(searches).toHaveCount(0);
  await expect(search).toBeFocused();
  await page
    .getByRole("button", { name: "Clear recently opened tasks" })
    .click();
  await expect(opened).toHaveCount(0);
});
