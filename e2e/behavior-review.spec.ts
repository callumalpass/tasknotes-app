import { expect, test } from "./local-test";

test("twelve statuses and priorities filter without losing keyboard selection", async ({
  page,
}) => {
  await page.goto("?demo=60&many-options");
  for (const property of ["Priority", "Status"]) {
    const row = page.locator(".task-row").first();
    await row.getByRole("button", { name: /^Task actions for/ }).click();
    await page
      .getByRole("menuitem", { name: new RegExp(`^${property}`) })
      .click();
    const filter = page.getByRole("combobox", { name: `Filter ${property}` });
    await expect(filter).toBeFocused();
    await expect(page.getByRole("menuitemradio")).toHaveCount(12);
    const option = page.getByRole("menuitemradio").last();
    const label = (await option.textContent())!.trim();
    await filter.fill(label);
    await expect(page.getByRole("menuitemradio")).toHaveCount(1);
    await filter.press("Enter");
    await expect(filter).toHaveCount(0);
  }
});

test("Search preserves result order and matches through reschedule and Undo", async ({
  page,
}) => {
  await page.goto("search?demo=60");
  await page.getByRole("searchbox", { name: "Search tasks" }).fill("Review");
  const rows = page.locator(".search-results .task-row");
  await expect.poll(() => rows.count()).toBeGreaterThan(10);
  const order = await rows.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-task-id")),
  );
  await rows.nth(9).locator(".task-row-title").focus();
  await page.keyboard.press("v");
  await rows.nth(10).locator(".task-row-title").focus();
  await page.keyboard.press("v");
  await page.getByRole("combobox", { name: "Schedule selected tasks" }).click();
  await page.getByRole("option", { name: "Tomorrow", exact: true }).click();
  await expect(page.locator(".bulk-update-notice")).toBeVisible();
  await expect(rows).toHaveCount(order.length);
  expect(
    await rows.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-task-id")),
    ),
  ).toEqual(order);
  await page
    .locator(".bulk-update-notice")
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect(page.locator(".bulk-update-notice")).toHaveCount(0);
  await expect(rows).toHaveCount(order.length);
  expect(
    await rows.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-task-id")),
    ),
  ).toEqual(order);
});
