import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./local-test";

async function openCapture(page: import("@playwright/test").Page) {
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  const trigger =
    (page.viewportSize()?.width ?? 1280) < 840
      ? page.locator(".view-context-capture")
      : page
          .getByRole("button", { name: "New task", exact: true })
          .filter({ visible: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "New task", exact: true });
  await expect(
    dialog.getByRole("combobox", { name: "New task title" }),
  ).toBeFocused();
  return dialog;
}

test("compact capture, priority and keyboard completion in both themes", async ({
  page,
}, testInfo) => {
  await page.setViewportSize(
    testInfo.project.name === "mobile"
      ? { width: 390, height: 844 }
      : { width: 1280, height: 800 },
  );
  await page.goto("?demo=60");
  const dialog = await openCapture(page);
  const input = dialog.getByRole("combobox", { name: "New task title" });
  await input.fill("Call Rowan tomorrow 3pm #work every week !high");
  await expect(dialog.locator(".capture-title-preview")).toHaveText(
    "Task: Call Rowan",
  );
  await expect(
    dialog.getByRole("button", { name: "Edit High", exact: true }),
  ).toHaveText("Priority: High");
  await expect(dialog.locator("mark").last()).toHaveText("!high");
  await expect(
    dialog.getByRole("button", { name: "Remove scheduled" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Remove Weekly" }),
  ).toBeVisible();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({
      path: testInfo.outputPath(
        `capture-${testInfo.project.name}-${colorScheme}.png`,
      ),
    });
    const results = await new AxeBuilder({ page })
      .include(".global-capture-dialog")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  }
  const box = await dialog.boundingBox();
  if (testInfo.project.name === "desktop") {
    expect(box!.y).toBeLessThan(120);
    expect(box!.height).toBeLessThan(260);
  }
  await input.fill("Call Rowan #");
  const options = dialog.getByRole("option");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await input.press("ArrowDown");
  await input.press("ArrowUp");
  await input.press("Tab");
  await expect(input).toHaveValue(/Call Rowan #\S+ $/);
  await expect(dialog.getByRole("listbox")).toHaveCount(0);
  await input.fill("Call Rowan !");
  await expect(dialog.getByRole("listbox")).toBeVisible();
  await input.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("listbox")).toHaveCount(0);
  await input.press("Shift+Enter");
  await expect(
    dialog.getByRole("button", { name: "Scheduled date", exact: true }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: "Close new task" }).click();
  await openCapture(page);
  await expect(input).toHaveValue("Call Rowan !");
});

test("Enter captures without navigation and Undo removes that task through the normal command", async ({
  page,
}) => {
  await page.goto("?demo=60");
  const dialog = await openCapture(page);
  await dialog.getByRole("combobox").fill("Capture to undo !high");
  await dialog.getByRole("combobox").press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  const notice = page.locator(".task-added-notice");
  await expect(notice).toContainText("Task added: Capture to undo");
  await expect(
    notice.getByRole("button", { name: "Open", exact: true }),
  ).toBeVisible();
  await notice.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect(
    page
      .locator(".undo-toast")
      .filter({ hasText: "Deleted “Capture to undo”" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Capture to undo", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
});

test("keep adding retains focus", async ({ page }) => {
  await page.goto("?demo=60");
  const dialog = await openCapture(page);
  const input = dialog.getByRole("combobox");
  await dialog.getByRole("checkbox", { name: "Keep adding tasks" }).check();
  await input.fill("First quick task p2");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close new task" }).click();
});

test("inline Today and Project capture share priority parsing", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile",
    "Inline capture is desktop only",
  );
  await page.goto("?demo=60");
  const inline = page.locator(".view-detail > .capture-composer");
  await inline.getByRole("combobox").fill("Today inline !high");
  await expect(
    inline.getByRole("button", { name: "Edit High", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("inline-today.png") });
  await inline.getByRole("combobox").press("Enter");
  await expect(inline.getByRole("combobox")).toHaveValue("");
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page
    .getByRole("button", { name: "Add task to Field research" })
    .click();
  await inline.getByRole("combobox").fill("Project inline !high");
  await expect(
    inline.getByRole("button", { name: "Edit +Field research", exact: true }),
  ).toBeVisible();
  await expect(
    inline.getByRole("button", { name: "Edit High", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("inline-project.png") });
  await inline.getByRole("combobox").press("Enter");
  await expect(
    page.getByRole("button", { name: "Project inline", exact: true }),
  ).toBeVisible();
});

test("capture names a two-week repeat and Discard keeps the caret", async ({
  page,
}) => {
  await page.goto("?demo=60");
  const dialog = await openCapture(page);
  const input = dialog.getByRole("combobox", { name: "New task title" });
  await input.fill("Pay supplier next tuesday every 2 weeks");
  await expect(dialog.locator(".capture-interpretation")).toContainText(
    "Every 2 weeks",
  );
  await dialog.getByRole("button", { name: "Discard draft" }).click();
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
});
