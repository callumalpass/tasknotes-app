import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Disposable in-memory demo only: never opens a Connect authority or LAB.
test("daily list, capture and detail remain clear and keyboard accessible", async ({
  page,
}, testInfo) => {
  await page.goto("?demo=50");
  const title = page.getByRole("button", {
    name: "Prepare quarterly planning session",
    exact: true,
  });
  await expect(title).toBeVisible();
  const firstRow = title.locator(
    "xpath=ancestor::div[contains(@class, 'task-row')][1]",
  );
  await expect(
    firstRow.getByRole("button", { name: /^Scheduled:/ }),
  ).not.toHaveClass(/is-compact/);
  await expect(firstRow.getByRole("button", { name: /^Due:/ })).not.toHaveClass(
    /is-compact/,
  );
  const overdue = page.getByRole("button", { name: /^Overdue \d+$/ });
  await overdue.click();
  await expect(title).not.toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("today-collapsed.png"),
    fullPage: false,
  });
  await page.reload();
  await expect(overdue).toHaveAttribute("aria-expanded", "false");
  await overdue.click();
  await expect(title).toBeVisible();

  await page.getByLabel("View options", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Reorder tasks", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("View options", { exact: true })).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Edit Today" }),
  ).not.toBeVisible();
  await page.getByLabel("View options", { exact: true }).click();
  await page
    .getByRole("button", { name: "Reorder tasks", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Reorder Prepare quarterly/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Done reordering" }).click();
  await expect(
    page.getByRole("button", { name: /Reorder Prepare quarterly/ }),
  ).toHaveCount(0);
  await expect(page.getByText("Drop here", { exact: true })).toHaveCount(0);

  if (testInfo.project.name === "mobile") {
    await expect(page.locator(".view-context-capture")).toBeVisible();
    await expect(
      page.locator(".view-detail > .capture-composer"),
    ).not.toBeVisible();
    await page.locator(".view-context-capture").click();
  } else {
    await page
      .getByRole("button", { name: "New task", exact: true })
      .filter({ visible: true })
      .click();
  }
  const dialog = page.getByRole("dialog", { name: "New task" });
  const input = dialog.getByRole("combobox", { name: "New task title" });
  await expect(input).toBeFocused();
  await input.fill("Call Rowan tomorrow 9am");
  await expect(
    dialog.getByRole("button", { name: "Remove scheduled" }),
  ).toBeVisible();
  await expect(dialog.locator(".capture-title-preview")).toContainText(
    "Call Rowan",
  );
  await dialog.getByRole("button", { name: "Remove scheduled" }).click();
  await expect(
    dialog.getByRole("button", { name: "Remove scheduled" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("capture.png"),
    fullPage: false,
  });
  await dialog.getByRole("checkbox", { name: "Keep adding tasks" }).check();
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await dialog.getByRole("button", { name: "Close new task" }).click();

  await title.focus();
  await page.keyboard.press("Enter");
  const detail = page.getByRole("complementary", { name: "Task details" });
  await expect(detail).toBeFocused();
  await expect(
    detail.getByRole("textbox", { name: "Notes", exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByText("Schedule and status", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("task-detail.png"),
    fullPage: true,
  });
  await detail.getByRole("button", { name: "Back", exact: true }).click();
  await expect(title).toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath("today-light.png"),
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({
    path: testInfo.outputPath("today-dark.png"),
    fullPage: true,
  });
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    results.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
});

test("capture stays above an overlay keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const viewport = new EventTarget();
    Object.defineProperties(viewport, {
      height: { value: 430, writable: true },
      offsetTop: { value: 0 },
    });
    Object.defineProperty(window, "visualViewport", {
      value: viewport,
      configurable: true,
    });
  });
  await page.goto("?demo=12");
  await page.locator(".view-context-capture").click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await expect(
    dialog.getByRole("combobox", { name: "New task title" }),
  ).toBeFocused();
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(431);
});

test("list and note detail fit narrow phones through desktop", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Explicit viewports cover this matrix",
  );
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("?demo=12");
    const task = page.getByRole("button", {
      name: "Prepare quarterly planning session",
      exact: true,
    });
    await expect(task).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await task.click();
    await expect(
      page.getByRole("textbox", { name: "Notes", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: testInfo.outputPath(`detail-${width}.png`),
      fullPage: false,
    });
  }
});
