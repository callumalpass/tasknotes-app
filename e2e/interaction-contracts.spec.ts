import { expect, test } from "./local-test";
import AxeBuilder from "@axe-core/playwright";

test("calendar and Scratchpad controls satisfy semantic and target-size contracts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?demo=50");
  const dates = page.locator(
    ".task-row-property, .task-row .task-actions-trigger",
  );
  await expect(dates.first()).toBeVisible();
  expect(
    await dates.evaluateAll((nodes) =>
      nodes.every((node) => {
        const box = node.getBoundingClientRect();
        return box.height >= 44 && box.width >= 44;
      }),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Scratchpad", exact: true }).click();
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter(
      (item) => item.impact === "serious" || item.impact === "critical",
    ),
  ).toEqual([]);
  await page.goto("?demo=50");
  await page.getByRole("button", { name: "Browse", exact: true }).click();
  await page.getByRole("menuitem", { name: "Calendar", exact: true }).click();
  await expect(
    page.locator(".full-calendar-event-content").first(),
  ).toBeVisible();
  expect(
    await page.locator(".full-calendar-event-content").evaluateAll((nodes) =>
      nodes.every((node) => {
        const box = node.getBoundingClientRect();
        return box.width >= 44 && box.height >= 44;
      }),
    ),
  ).toBe(true);
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter(
      (item) => item.impact === "serious" || item.impact === "critical",
    ),
  ).toEqual([]);
});

test("notes and reminder controls reflow at 320px and 200% text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("?demo=50");
  await page.locator(".task-row-title").first().click();
  await page.locator("details").evaluateAll((nodes) =>
    nodes.forEach((node) => {
      node.open = true;
    }),
  );
  await page.getByRole("button", { name: "Add reminder", exact: true }).click();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
});

test("large lists keep a bounded DOM while scrolling and preserve detail focus", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("?demo=5000");
  await expect(page.locator(".task-row-title").first()).toBeVisible();
  expect(await page.locator(".task-row").count()).toBeLessThan(80);
  expect(await page.locator("*").count()).toBeLessThan(3000);
  const initial = await page.locator(".task-row-title").first().textContent();
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight / 2),
  );
  await expect
    .poll(() => page.locator(".task-row-title").first().textContent())
    .not.toBe(initial);
  const title = await page.locator(".task-row-title").evaluateAll(
    (nodes) =>
      nodes.find((node) => {
        const rect = node.getBoundingClientRect();
        return rect.top > 150 && rect.bottom < window.innerHeight - 100;
      })?.textContent,
  );
  expect(title).toBeTruthy();
  const trigger = page.getByRole("button", { name: title!, exact: true });
  await trigger.click();
  const detail = page.getByRole("complementary", { name: "Task details" });
  await expect(detail).toBeFocused();
  await detail.getByRole("button", { name: "Back", exact: true }).click();
  await expect(trigger).toBeFocused();
  await expect(page.getByText(/Loaded 200 of .* matching tasks/)).toBeVisible();
  await page
    .getByRole("button", { name: "Load more tasks", exact: true })
    .click();
  await expect(page.getByText(/Loaded 400 of .* matching tasks/)).toBeVisible();
  expect(await page.locator(".task-row").count()).toBeLessThan(80);
});

// Local, disposable fixtures only. These are failure-sequence contracts, not screenshots.
test("nested Escape preserves capture and dismissing preserves its draft", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?demo=50");
  await page.locator(".view-context-capture").click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  const input = dialog.getByRole("combobox", { name: "New task title" });
  await input.fill("Important task #wo");
  await expect(
    page.getByRole("listbox", { name: "Task field suggestions" }),
  ).toBeVisible();
  await input.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(input).toBeFocused();
  await input.fill("Book a room tomorrow");
  await dialog
    .getByRole("button", { name: "Edit scheduled", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Scheduled date", exact: true })
    .click();
  await expect(dialog.getByRole("grid")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("grid")).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close new task" }).click();
  await page.locator(".view-context-capture").click();
  await expect(input).toHaveValue("Book a room tomorrow");
  await dialog.getByRole("button", { name: "Discard draft" }).click();
  await expect(input).toHaveValue("");
});

test("mobile property editing is truly modal and restores its trigger", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?demo=50");
  const trigger = page
    .locator(".task-row")
    .first()
    .getByRole("button", { name: /^Scheduled:/ });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Edit Scheduled" });
  await expect(dialog).toBeVisible();
  expect(
    await page.locator("#root").evaluate((root) => (root as HTMLElement).inert),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Clear value" }).focus();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close property editor" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Clear value" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(
    await page.locator("#root").evaluate((root) => (root as HTMLElement).inert),
  ).toBe(false);
});
