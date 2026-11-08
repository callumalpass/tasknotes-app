import { expect, test, type Page } from "./local-test";
import { openFixture } from "./next-fixture";

test("long row values fit at 390px and the native-discovered Today links to overdue", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    hasTouch: false,
  });
  const page = await context.newPage();
  try {
    const project = "[test] agent-20261106T195757Z-790981 project edited";
    const token = "Unbroken".repeat(40);
    await openFixture(page, {
      viewProperties: [
        "note.title",
        "note.projects",
        "note.tags",
        "note.reference",
      ],
      viewOptions: { sections: "day", create: false },
      records: [
        {
          path: "tasks/long-values.md",
          types: ["task"],
          frontmatter: {
            title: "Long metadata regression",
            status: "open",
            scheduled: "2000-01-01",
            dateCreated: "2026-11-07T00:00:00Z",
            dateModified: "2026-11-07T00:00:00Z",
            projects: [project],
            tags: [token],
            reference: token,
          },
          body: "",
        },
      ],
    });
    const row = page
      .locator(".task-row")
      .filter({ hasText: "Long metadata regression" });
    await page.locator(".task-row, .view-execution-error").first().waitFor();
    expect(
      await page.locator(".view-execution-error").allTextContents(),
    ).toEqual([]);
    await expect(row).toBeVisible();
    const link = page.getByRole("link", { name: "1 overdue", exact: true });
    await expect(link).toBeVisible();
    const toggle = page.getByRole("button", { name: "Overdue 1", exact: true });
    await toggle.click();
    await link.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toBeFocused();
    await expectNoHorizontalOverflow(page);
    const values = row.locator(".task-row-inline-metadata .task-row-value");
    await expect(values).toHaveCount(3);
    const geometry = await values.evaluateAll((elements) =>
      elements.map((element) => ({
        width: element.getBoundingClientRect().width,
        right: element.getBoundingClientRect().right,
        content: element.scrollWidth,
        overflow: getComputedStyle(element).textOverflow,
      })),
    );
    console.log(JSON.stringify({ viewport: 390, metadata: geometry }));
    await page.screenshot({ path: test.info().outputPath("today-390.png") });
    expect(
      geometry.every(
        (value) =>
          value.width > 0 &&
          value.right <= 390 &&
          value.overflow === "ellipsis",
      ),
    ).toBe(true);
    expect(geometry.some((value) => value.content > value.width)).toBe(true);
  } finally {
    await context.close();
  }
});

const rows = (page: Page) =>
  page.locator("[data-task-selection-list] .task-row");
const selectedRows = (page: Page) =>
  rows(page).filter({
    has: page.locator(".task-row-title[aria-pressed=true]"),
  });

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

const route = (name: string) =>
  `views/${encodeURIComponent(`TaskNotes/Views/${name}.base#${name}`)}?demo=60`;

test("phone navigation and capture save without leaving the current view", async ({
  page,
}) => {
  await page.goto("?demo=60");
  await expect(page.locator(".task-row").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const navigation = page.getByRole("navigation", {
    name: "Primary",
    exact: true,
  });
  await navigation
    .getByRole("button", { name: "Scratchpad", exact: true })
    .tap();
  await expect(
    page.getByRole("heading", { name: "Scratchpad", exact: true }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await navigation.getByRole("button", { name: "Today", exact: true }).tap();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  const trigger = page.locator(".view-context-capture");
  const bounds = (await trigger.boundingBox())!;
  expect(bounds.width).toBeGreaterThanOrEqual(44);
  expect(bounds.height).toBeGreaterThanOrEqual(44);
  await trigger.tap();
  const dialog = page.getByRole("dialog", { name: "New task", exact: true });
  await dialog
    .getByRole("textbox", { name: "New task title" })
    .fill("Phone capture regression");
  await dialog.getByRole("button", { name: "Add", exact: true }).tap();
  await expect(dialog).toHaveCount(0);
  const notice = page.locator(".task-added-notice");
  await expect(notice).toContainText("Phone capture regression");
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  await notice.getByRole("button", { name: "Open", exact: true }).tap();
  await expect(
    page.getByRole("textbox", { name: "Task title", exact: true }),
  ).toHaveValue("Phone capture regression");
  await expectNoHorizontalOverflow(page);
});

test("touch property editing saves, is truly modal and restores its trigger", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?demo=60");
  const trigger = page.locator(".task-row-properties-trigger").first();
  await trigger.tap();
  const dialog = page.getByRole("dialog", {
    name: "Task properties",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox", { name: "Priority", exact: true }).tap();
  await page.getByRole("option", { name: "Low", exact: true }).tap();
  await dialog.getByRole("button", { name: "Done", exact: true }).tap();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.tap();
  await expect(
    dialog.getByRole("combobox", { name: "Priority", exact: true }),
  ).toContainText("Low");
  expect(
    await page.locator("#root").evaluate((root) => (root as HTMLElement).inert),
  ).toBe(true);
  const last = dialog.getByRole("button", {
    name: "Done",
    exact: true,
  });
  await last.focus();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close property editor" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(
    await page.locator("#root").evaluate((root) => (root as HTMLElement).inert),
  ).toBe(false);
});

test("touch month selection consumes its compatibility click, not the next intentional tap", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 412, height: 713 });
  await page.clock.setFixedTime(new Date("2026-11-06T10:00:00"));
  await page.goto(route("calendar"));
  const day = page.locator('.tnc-dg-day[data-date="2026-11-06"]');
  await expect(day).toBeVisible();
  await day.tap();
  const agenda = page.getByRole("complementary", { name: "Selected day" });
  await expect(agenda).toBeVisible();
  await expect(agenda.locator(".task-row-title").first()).toBeInViewport();
  await expect(page).not.toHaveURL(/\/task\//);
  await expect(
    page.getByRole("textbox", { name: "Task title", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("phone-month-day.png"),
  });
  await agenda.locator(".task-row-title").first().tap();
  await expect(
    page.getByRole("textbox", { name: "Task title", exact: true }),
  ).toBeVisible();
});

test("phone expanded agenda keeps compact markers and selected-day capture", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("views/TaskNotes%2FViews%2Fupcoming.base%23upcoming?demo=60");
  await page.locator(".agenda-range-toggle").click();
  const strip = page.locator(".tnc-strip");
  await expect(strip).toHaveClass(/is-expanded/);
  const marker = strip.locator(".tnc-strip-day.is-focus .tnc-strip-num");
  const bounds = (await marker.boundingBox())!;
  expect(Math.abs(bounds.width - bounds.height)).toBeLessThan(1);
  await expect(
    strip.locator(".agenda-strip-count", { hasText: /^0$/ }),
  ).toHaveCount(0);
  const selected = await strip
    .locator(".tnc-strip-day.is-focus")
    .getAttribute("data-date");
  await expect(
    page.locator(`.tnc-list-section[data-date="${selected}"] .tnc-list-add`),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath("phone-agenda.png") });
});

test("touch long press selects, tap toggles, and swipes still act outside selection mode", async ({
  page,
}) => {
  await page.goto("?demo=60");
  await expect(rows(page).first()).toBeVisible();
  const row = rows(page).first();
  const title = row.locator(".task-row-title");
  await title.dispatchEvent("pointerdown", {
    pointerType: "touch",
    pointerId: 2,
    clientX: 150,
    clientY: 250,
  });
  await page.waitForTimeout(550);
  await title.dispatchEvent("pointerup", {
    pointerType: "touch",
    pointerId: 2,
    clientX: 150,
    clientY: 250,
  });
  await title.dispatchEvent("click", { pointerType: "touch" });
  await expect(selectedRows(page)).toHaveCount(1);
  await rows(page).nth(2).locator(".task-row-title").tap();
  await expect(selectedRows(page)).toHaveCount(2);
  await page
    .locator(".bulk-actions")
    .getByRole("button", { name: "Clear", exact: true })
    .tap();
  await title.dispatchEvent("pointerdown", {
    pointerType: "touch",
    pointerId: 3,
    clientX: 80,
    clientY: 250,
  });
  await title.dispatchEvent("pointermove", {
    pointerType: "touch",
    pointerId: 3,
    clientX: 190,
    clientY: 250,
  });
  await title.dispatchEvent("pointerup", {
    pointerType: "touch",
    pointerId: 3,
    clientX: 190,
    clientY: 250,
  });
  await expect(page.locator(".bulk-actions")).toHaveCount(0);
  await expect(row).not.toHaveAttribute("data-selected", "true");
  // Native touch context menus can arrive before the hold timer.
  await page.goto("?demo=60");
  await expect(rows(page).first()).toBeVisible();
  await title.dispatchEvent("pointerdown", {
    pointerType: "touch",
    pointerId: 5,
    clientX: 150,
    clientY: 250,
  });
  await title.dispatchEvent("contextmenu", { clientX: 150, clientY: 250 });
  await title.dispatchEvent("pointerup", {
    pointerType: "touch",
    pointerId: 5,
    clientX: 150,
    clientY: 250,
  });
  await title.dispatchEvent("click", { pointerType: "touch" });
  await expect(selectedRows(page)).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
