import { expect, test } from "./local-test";

test("long task-action pickers filter without losing keyboard selection", async ({
  page,
}, testInfo) => {
  await page.goto("/?demo=60&many-options");
  const row = page.locator(".task-row").first();
  await row.getByRole("button", { name: /^Task actions for/ }).click();
  await page.getByRole("menuitem", { name: /^Status/ }).click();
  const filter = page.getByRole("combobox", { name: "Filter Status" });
  await expect(filter).toBeFocused();
  const option = page.getByRole("menuitemradio").last();
  const label = (await option.textContent())!.trim();
  await filter.fill(label);
  await expect(page.getByRole("menuitemradio")).toHaveCount(1);
  await page.screenshot({
    path: `/tmp/tasknotes-behavior/${testInfo.project.name}-picker.png`,
  });
  await filter.press("Enter");
  await expect(filter).toHaveCount(0);
});

test("quick dates keep uncommon controls behind disclosure", async ({
  page,
  isMobile,
}, testInfo) => {
  await page.goto("/?demo=60");
  const row = page.locator(".task-row").first();
  if (isMobile) {
    await row.getByRole("button", { name: /^Task actions for/ }).click();
    await page.getByRole("menuitem", { name: "Dates", exact: true }).click();
  } else {
    await row.getByRole("button", { name: /^Change dates for/ }).click();
  }
  const panel = page.locator(".task-date-panel");
  await expect(
    panel.getByRole("button", { name: "This weekend", exact: true }),
  ).toBeVisible();
  await expect(panel.getByLabel("Type a date")).not.toBeVisible();
  await page.screenshot({
    path: `/tmp/tasknotes-behavior/${testInfo.project.name}-date.png`,
  });
  await panel.getByText("Date options", { exact: true }).click();
  await expect(panel.getByLabel("Type a date")).toBeVisible();
});

test("phone detail keeps set properties and reveals empty properties on demand", async ({
  page,
  isMobile,
}, testInfo) => {
  await page.goto("/search?demo=60");
  await page
    .getByRole("searchbox", { name: "Search tasks" })
    .fill("Review demo task 15");
  await page.locator(".search-results .task-row-title").click();
  await expect(
    page.getByRole("textbox", { name: "Notes", exact: true }),
  ).toBeVisible();
  const phone = isMobile;
  const due = page.getByRole("button", { name: "Due date", exact: true });
  if (phone) {
    await expect(due).not.toBeVisible();
    const notes = await page
      .getByRole("heading", { name: "Notes", exact: true })
      .boundingBox();
    expect(notes!.y).toBeLessThan(600);
    await page.screenshot({
      path: `/tmp/tasknotes-behavior/${testInfo.project.name}-detail.png`,
    });
    await page
      .getByRole("button", { name: "Add property", exact: true })
      .click();
  }
  await expect(due).toBeVisible();
});

test("Upcoming title scrolls away while its compact week strip remains", async ({
  page,
}, testInfo) => {
  await page.goto(
    "/views/TaskNotes%2FViews%2Fupcoming.base%23upcoming?demo=60",
  );
  await expect(page.locator(".tnc-strip")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Overdue \d+$/ }),
  ).toBeVisible();
  await page.screenshot({
    path: `/tmp/tasknotes-behavior/${testInfo.project.name}-upcoming.png`,
  });
  await page.evaluate(() => window.scrollTo(0, 450));
  await expect
    .poll(async () => (await page.locator(".tnc-strip").boundingBox())!.y)
    .toBeLessThanOrEqual(1);
  await page.screenshot({
    path: `/tmp/tasknotes-behavior/${testInfo.project.name}-upcoming-scrolled.png`,
  });
});

test("Search preserves result order, scroll and matches through reschedule and Undo", async ({
  page,
}, testInfo) => {
  await page.goto("/search?demo=60");
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
  const before = await page.evaluate(() => window.scrollY);
  await page.getByRole("combobox", { name: "Schedule selected tasks" }).click();
  await page.getByRole("option", { name: "Tomorrow", exact: true }).click();
  await expect(page.locator(".bulk-update-notice")).toBeVisible();
  await expect(rows).toHaveCount(order.length);
  expect(
    await rows.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-task-id")),
    ),
  ).toEqual(order);
  expect(
    Math.abs((await page.evaluate(() => window.scrollY)) - before),
  ).toBeLessThan(30);
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
  expect(
    Math.abs((await page.evaluate(() => window.scrollY)) - before),
  ).toBeLessThan(30);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const action = await rows
    .last()
    .getByRole("button", { name: /^Task actions for/ })
    .boundingBox();
  if (testInfo.project.name.startsWith("phone")) {
    const fab = await page.locator(".global-capture-fab:visible").boundingBox();
    expect(action!.y + action!.height).toBeLessThan(fab!.y);
  }
  await page.screenshot({
    path: `/tmp/tasknotes-behavior/${testInfo.project.name}-last-row.png`,
  });
});

test("Scratchpad keeps reference labels visible while editing around them", async ({
  page,
}, testInfo) => {
  await page.goto("/scratchpad?demo=60");
  const input = page.locator(".scratchpad-current-document textarea").last();
  await input.fill("Before [[Tasks/Parent.md|Parent task]] after");
  await expect(input).toHaveValue("Before Parent task after");
  await input.press("End");
  await input.pressSequentially("wards");
  await expect(input).toHaveValue("Before Parent task afterwards");
  const row = input.locator(
    "xpath=ancestor::*[contains(concat(' ', @class, ' '), ' scratchpad-row ')][1]",
  );
  await expect(row.locator(".outline-link")).toBeVisible();
  await page.screenshot({
    path: `/tmp/tasknotes-behavior/${testInfo.project.name}-reference.png`,
  });
  await row.getByRole("button", { name: "Edit reference Markdown" }).click();
  await expect(input).toHaveValue(
    "Before [[Tasks/Parent.md|Parent task]] afterwards",
  );
});
