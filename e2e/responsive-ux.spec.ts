import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await page.evaluate(async () => {
    localStorage.clear();
    await Promise.all(
      ["tasknotes-index-v2", "tasknotes-commands-v2"].map(
        (name) =>
          new Promise<void>((resolve, reject) => {
            const request = indexedDB.deleteDatabase(name);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
            request.onblocked = () =>
              reject(new Error(`Database reset was blocked: ${name}`));
          }),
      ),
    );
    const root = await navigator.storage.getDirectory();
    await root
      .removeEntry("TaskNotes", { recursive: true })
      .catch(() => undefined);
    localStorage.setItem("tasknotes:collection-choice:v1", "local");
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Today", level: 1 }),
  ).toBeVisible();
});

test("keeps navigation calm across the phone and rail boundary", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");

  await page.setViewportSize({ width: 839, height: 900 });
  const bottomNavigation = page.locator(".bottom-navigation");
  await expect(bottomNavigation).toBeVisible();
  await expect(bottomNavigation.getByRole("button")).toHaveCount(5);
  await expect(page.locator(".navigation-rail")).toBeHidden();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("shell-839.png"),
  });

  await page.setViewportSize({ width: 840, height: 900 });
  await expect(bottomNavigation).toBeHidden();
  await expect(page.locator(".navigation-rail")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("shell-840.png"),
  });
});

test("uses a modal sheet on phones and an anchored menu on wider screens", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  await page.getByRole("button", { name: "Turn off manual order" }).click();
  await expect(
    page.getByRole("button", { name: "Turn on manual order" }),
  ).toBeVisible();
  const capture = page.getByLabel("New task title");
  await capture.fill("Responsive action surface");
  await expect(page.getByText("Plain task", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText("Responsive action surface", { exact: true }),
  ).toBeVisible();

  await page.setViewportSize({ width: 839, height: 900 });
  const trigger = page.getByRole("button", {
    name: "Task actions for Responsive action surface",
  });
  await trigger.click();
  const sheet = page.getByRole("dialog", { name: "Responsive action surface" });
  await expect(sheet).toBeVisible();
  await expect(page.locator(".task-actions-scrim")).toBeVisible();
  await expect
    .poll(() => sheet.evaluate((node) => node.getBoundingClientRect().width))
    .toBe(839);
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .toBe("hidden");
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("task-actions-839.png"),
  });
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();

  await page.setViewportSize({ width: 840, height: 900 });
  await trigger.click();
  await expect(
    page.getByRole("menu", { name: "Actions for Responsive action surface" }),
  ).toBeVisible();
  await expect(page.locator(".task-actions-scrim")).toHaveCount(0);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("task-actions-840.png"),
  });
});

test("changes task detail layout only at the documented split boundary", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  const capture = page.getByLabel("New task title");
  await capture.fill("Responsive task detail");
  await expect(page.getByText("Plain task", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText("Responsive task detail", { exact: true }),
  ).toBeVisible();

  await page.setViewportSize({ width: 1099, height: 900 });
  await page.getByText("Responsive task detail", { exact: true }).click();
  await expect(page.locator("#main-content")).toBeHidden();
  await expect(
    page.getByRole("complementary", { name: "Task details" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(page.locator("#main-content")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Today", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Task details" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("keeps search, settings, and new-view setup focused on the next decision", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  await page.setViewportSize({ width: 412, height: 915 });

  await page.getByRole("button", { name: "Search", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search tasks" });
  await expect(search).toBeFocused();
  await expectNoHorizontalOverflow(page);
  await search.evaluate((element) => element.blur());

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "About & portability" }),
  ).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("settings-412.png"),
  });

  await page.getByRole("button", { name: "Views", exact: true }).click();
  await page.getByRole("menuitem", { name: "Manage views" }).click();
  await page.getByRole("button", { name: "Create view" }).click();
  const editor = page.getByRole("dialog", { name: "Create a view" });
  await expect(
    editor.getByText(
      "Start with a name and layout. Everything else is optional.",
    ),
  ).toBeVisible();
  await expect(editor.getByRole("heading", { name: "Filter" })).toBeVisible();
  await expect(
    editor.getByText("No computed properties.", { exact: true }),
  ).toBeHidden();
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("view-editor-412.png"),
  });
});

async function expectNoHorizontalOverflow(
  page: import("@playwright/test").Page,
): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}
