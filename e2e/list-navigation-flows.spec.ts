import { expect, test } from "./local-test";

test.beforeEach(async ({ page }) => {
  await page.goto("?demo=60&many-options");
  await expect(page.locator(".task-row").first()).toBeVisible();
});

test("overdue leads, accepts another date, and restores its dates with Undo", async ({
  page,
}) => {
  await expect(page.locator(".task-section-toggle").first()).toContainText(
    "Overdue",
  );
  await page.getByRole("button", { name: "Choose date", exact: true }).click();
  const date = new Date();
  date.setDate(date.getDate() + 4);
  const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  await page.getByLabel("Date for overdue tasks").fill(value);
  await page.getByRole("button", { name: "Schedule all", exact: true }).click();
  const label = new Intl.DateTimeFormat("en", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
  await expect(page.locator(".undo-toast")).toContainText(`to ${label}`);
  await expect(page.locator(".undo-toast")).toContainText("deadline");
  await page
    .locator(".undo-toast")
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect(page.locator(".task-section-toggle").first()).toContainText(
    "Overdue",
  );
});

test("completion shortcut undo clears its toast and restores row focus", async ({
  page,
}) => {
  const title = page.locator(".task-row-title").first();
  const label = (await title.textContent())!.trim();
  await title.focus();
  await page.keyboard.press("x");
  await expect(page.locator(".task-completed-notice")).toContainText(
    `Completed “${label}”`,
  );
  await expect(
    page.getByRole("button", { name: label, exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".task-completed-notice")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: label, exact: true }),
  ).toBeFocused();
});

test("extended selection keeps the focused row above the bulk bar", async ({
  page,
  isMobile,
}) => {
  await page.locator(".task-row-title").first().focus();
  for (let index = 0; index < 14; index++) await page.keyboard.press("Shift+j");
  const bar = page.locator(".bulk-actions");
  await expect(bar).toBeVisible();
  await expect
    .poll(async () => {
      const row = await page
        .locator(".task-row:has(.task-row-title:focus)")
        .boundingBox();
      const bounds = await bar.boundingBox();
      return Boolean(row && bounds && row.y + row.height <= bounds.y);
    })
    .toBe(true);
  await expect(
    bar.getByRole("combobox", { name: "Move selected tasks to project" }),
  ).toBeVisible();
  if (!isMobile)
    expect(
      await bar
        .getByRole("combobox", { name: "Move selected tasks to project" })
        .locator("span")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
});

test("Unplanned lists only undated work and retains a count", async ({
  page,
  isMobile,
}) => {
  if (isMobile)
    await page.getByRole("button", { name: "More", exact: true }).click();
  await page
    .getByRole(isMobile ? "menuitem" : "button", { name: /^Unplanned/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Unplanned", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".task-row").first()).toBeVisible();
  await expect(
    page.locator(".task-row-property").filter({ hasText: /Scheduled|Due/ }),
  ).toHaveCount(0);
});

test("shortcut sheet uses its width and fits desktop without scrolling", async ({
  page,
  isMobile,
}) => {
  test.skip(
    isMobile,
    "Touch devices use the responsive sheet without keyboard shortcuts",
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.keyboard.press("?");
  const sheet = page.locator(".keyboard-shortcuts-sheet");
  await expect(sheet).toBeVisible();
  expect(
    await sheet.evaluate(
      (element) => element.scrollHeight <= element.clientHeight + 1,
    ),
  ).toBe(true);
  const primary = await sheet.locator(".task-shortcuts-primary").boundingBox();
  const bounds = await sheet.boundingBox();
  expect(primary!.x - bounds!.x).toBeLessThan(40);
});

test("sidebar footer stays pinned and project navigation leaves no rail offset", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Desktop sidebar only");
  await page.setViewportSize({ width: 1280, height: 800 });
  const settings = page
    .locator("aside")
    .getByRole("button", { name: "Settings", exact: true });
  const bounds = await settings.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(800);
  await page.locator(".navigation-project-section button").first().click();
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true }),
  ).toBeVisible();
  expect(
    await page.locator("aside").evaluate((element) => element.scrollTop),
  ).toBe(0);
});

test("desktop project metadata shares a fixed right anchor", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Phones retain wrapping metadata");
  await page.setViewportSize({ width: 1280, height: 800 });
  const edges = await page
    .locator(".task-row .is-project")
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().right),
    );
  expect(edges.length).toBeGreaterThan(2);
  expect(Math.max(...edges) - Math.min(...edges)).toBeLessThan(2);
  const capture = page.getByRole("combobox", { name: "New task title" });
  await expect(capture).toHaveAttribute("spellcheck", "false");
});

test("list visual checks at desktop and phone sizes in both themes", async ({
  page,
}, testInfo) => {
  for (const size of [
    { width: 1280, height: 800 },
    { width: 412, height: 915 },
  ]) {
    await page.setViewportSize(size);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await testInfo.attach(`lists-${size.width}-${colorScheme}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
  }
});

test("list destinations share a content column", async ({ page, isMobile }) => {
  test.skip(isMobile, "Desktop reading measure");
  await page.setViewportSize({ width: 1280, height: 800 });
  const columns: Array<{ x: number; width: number }> = [];
  for (const name of [
    "Today",
    "Upcoming",
    "Projects",
    "Unplanned",
    "Search",
    "Archive",
  ]) {
    await page
      .locator("aside")
      .getByRole("button", { name: new RegExp(`^${name}(?:,|$)`) })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name, exact: true }),
    ).toBeVisible();
    const column = await page.locator("main > .screen").boundingBox();
    columns.push({ x: column!.x, width: column!.width });
  }
  for (const column of columns) expect(column).toEqual(columns[0]);
});

test("long project and priority labels keep their metadata lanes", async ({
  page,
  isMobile,
}) => {
  await page.locator(".task-row .is-project strong").evaluateAll((elements) => {
    for (const element of elements)
      element.textContent =
        "A very long project name for the cross-functional international delivery programme";
  });
  await page
    .locator('.task-row-property[aria-label^="Priority:"] strong')
    .evaluateAll((elements) => {
      for (const element of elements)
        element.textContent =
          "Custom priority needing a deliberately very long label";
    });
  const metadata = await page
    .locator(".task-row-properties:has(.is-project)")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const project = element
          .querySelector(".is-project")!
          .getBoundingClientRect();
        const bounds = element.getBoundingClientRect();
        const details = [...element.children]
          .filter((child) => !child.classList.contains("is-project"))
          .map((child) => child.getBoundingClientRect());
        return {
          projectRight: project.right,
          projectLeft: project.left,
          boundsRight: bounds.right,
          detailsRight: Math.max(0, ...details.map((detail) => detail.right)),
        };
      }),
    );
  expect(metadata.length).toBeGreaterThan(2);
  for (const row of metadata) {
    expect(row.projectRight).toBeLessThanOrEqual(row.boundsRight + 1);
    if (!isMobile) {
      expect(row.projectRight).toBeCloseTo(row.boundsRight, 0);
      expect(row.detailsRight).toBeLessThanOrEqual(row.projectLeft);
    }
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
