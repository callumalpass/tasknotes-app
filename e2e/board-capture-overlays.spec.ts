import { expect, test } from "./local-test";

const boardRoute = `views/${encodeURIComponent("TaskNotes/Views/work-board.base#work-board")}?demo=60`;

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme });

    test("board fits laptop columns and keeps short card titles on one line", async ({
      page,
      isMobile,
    }) => {
      test.skip(isMobile, "Desktop fit; phones snap to a whole column.");
      await page.setViewportSize({ width: 1280, height: 713 });
      await page.goto(boardRoute);
      await expect(page.locator(".kanban-column")).toHaveCount(4);
      expect(
        await page
          .locator(".kanban-board")
          .evaluate((board) => board.scrollWidth - board.clientWidth),
      ).toBe(0);
      const title = page
        .locator(".task-row-title-text")
        .filter({ hasText: "Review demo task 23" });
      expect(
        await title.evaluate(
          (element) =>
            element.getBoundingClientRect().height /
            parseFloat(getComputedStyle(element).lineHeight),
        ),
      ).toBeLessThan(1.1);
      expect(
        (await page.locator(".kanban-card").first().boundingBox())!.y,
      ).toBeLessThan(300);
      await page.goto(`${boardRoute}&many-options`);
      expect(
        await title.evaluate(
          (element) =>
            element.getBoundingClientRect().height /
            parseFloat(getComputedStyle(element).lineHeight),
        ),
      ).toBeLessThan(1.1);
    });

    test("many-column selection and jump strip survive desktop to phone reflow", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 713 });
      await page.goto(`${boardRoute}&many-options`);
      const jump = page.getByRole("navigation", { name: "Board columns" });
      const target = jump.getByRole("button", {
        name: "In review 5",
        exact: true,
      });
      await target.click();
      await page.setViewportSize({ width: 412, height: 713 });
      await expect(target).toHaveAttribute("aria-current", "true");
      await expect(target).toBeInViewport({ ratio: 1 });
      const column = page.getByRole("region", {
        name: "In review column",
        exact: true,
      });
      await expect
        .poll(async () =>
          Math.abs(
            (await column.boundingBox())!.x -
              (await page.locator(".kanban-board").boundingBox())!.x,
          ),
        )
        .toBeLessThan(2);
      await expect(column.locator(".kanban-card").first()).toBeInViewport({
        ratio: 1,
      });
    });

    test("long capture wraps with its highlights and project editing stays local", async ({
      page,
      isMobile,
    }) => {
      await page.setViewportSize({ width: isMobile ? 412 : 1280, height: 713 });
      await page.goto("?demo=60&many-options");
      await expect(
        page.getByRole("heading", { name: "Today", exact: true }),
      ).toBeVisible();
      const trigger = isMobile
        ? page.locator(".view-context-capture")
        : page
            .getByRole("button", { name: "New task", exact: true })
            .filter({ visible: true });
      await trigger.click();
      const dialog = page.getByRole("dialog", {
        name: "New task",
        exact: true,
      });
      const input = dialog.getByRole("combobox", { name: "New task title" });
      await input.fill(
        "Prepare an intentionally long project handover with enough detail to wrap the title clearly across multiple lines tomorrow +Product refresh",
      );
      await expect(
        dialog.getByRole("button", {
          name: "Edit +Product refresh",
          exact: true,
        }),
      ).toBeVisible();
      const height = (await input.boundingBox())!.height;
      expect(height).toBeGreaterThan(44);
      expect(height).toBeLessThanOrEqual(89.1);
      await expect(dialog.locator(".capture-title-preview")).toHaveClass(
        /visually-hidden/,
      );
      await dialog
        .getByRole("button", { name: "Edit +Product refresh", exact: true })
        .click();
      const project = dialog.getByRole("combobox", {
        name: "Projects",
        exact: true,
      });
      await expect(project).toBeFocused();
      await expect(project).toBeInViewport({ ratio: 1 });
      await expect(dialog.locator(".capture-details")).toHaveCount(0);
      await project.press("Escape");
      if (await project.count()) await project.press("Escape");
      await expect(
        dialog.getByRole("button", {
          name: "Edit +Product refresh",
          exact: true,
        }),
      ).toBeFocused();
    });

    test("command palette has a full-size visible close action beside search", async ({
      page,
      isMobile,
    }) => {
      await page.setViewportSize({ width: isMobile ? 412 : 1280, height: 713 });
      await page.goto("?demo=60&many-options");
      await expect(page.locator(".task-row").first()).toBeVisible();
      await page.keyboard.press("ControlOrMeta+k");
      const dialog = page.getByRole("dialog", { name: "Command palette" });
      const close = dialog.getByRole("button", { name: "Close", exact: true });
      await expect(close).toBeInViewport({ ratio: 1 });
      await expect
        .poll(async () => (await close.boundingBox())!.width)
        .toBeGreaterThanOrEqual(44);
      const search = (await dialog.getByRole("combobox").boundingBox())!;
      expect((await close.boundingBox())!.x).toBeGreaterThanOrEqual(
        search.x + search.width,
      );
      await close.click();
      await expect(dialog).toHaveCount(0);
    });

    test("view builder keeps layout compact and Save primary", async ({
      page,
      isMobile,
    }) => {
      await page.setViewportSize({ width: isMobile ? 412 : 1280, height: 713 });
      await page.goto("views?demo=60&many-options");
      await page
        .getByRole("button", { name: "Create view", exact: true })
        .click();
      const editor = page.getByRole("dialog");
      const layout = editor.locator(".view-layout-disclosure");
      await expect(layout).not.toHaveAttribute("open");
      await expect(
        editor.getByRole("heading", { name: "Filter", exact: true }),
      ).toBeInViewport({ ratio: 1 });
      await layout.locator("summary").click();
      await editor.getByRole("radio", { name: "Board", exact: true }).check();
      await expect(layout).not.toHaveAttribute("open");
      await editor
        .getByRole("textbox", { name: "View name" })
        .fill("Board draft");
      const save = editor.getByRole("button", {
        name: "Save view",
        exact: true,
      });
      await expect(save).toBeEnabled();
      await expect
        .poll(async () => (await save.boundingBox())!.height)
        .toBeGreaterThanOrEqual(44);
      expect(
        await save.evaluate(
          (element) => getComputedStyle(element).borderRadius,
        ),
      ).toBe("6px");
      expect(
        await save.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        ),
      ).not.toBe("rgba(0, 0, 0, 0)");
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Discard changes", exact: true })
        .click();
      await expect(editor).toHaveCount(0);
    });

    test("property picker names itself and provides a full-size close action", async ({
      page,
      isMobile,
    }) => {
      await page.setViewportSize({ width: isMobile ? 412 : 1280, height: 713 });
      await page.goto("?demo=60&many-options");
      await page.locator(".task-row-title").first().click();
      await page
        .getByRole("combobox", { name: "Status", exact: true })
        .first()
        .click();
      const picker = page.locator(
        ".tasknotes-select-popover[data-state='open']",
      );
      await expect(picker.locator(".choice-options-header")).toContainText(
        "Status",
      );
      const close = picker.getByRole("button", { name: "Close", exact: true });
      await expect
        .poll(async () => (await close.boundingBox())!.width)
        .toBeGreaterThanOrEqual(44);
      const bounds = (await close.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      await picker.getByRole("combobox").press("End");
      await expect(picker.locator(".is-active")).toBeInViewport({ ratio: 1 });
      await close.click();
      await expect(picker).toHaveCount(0);
    });
  });
}

test("a distant jump-strip destination accepts a dragged card", async ({
  page,
  isMobile,
}) => {
  test.skip(
    isMobile,
    "Desktop pointer drag; the same drop hit-testing serves touch.",
  );
  await page.goto(`${boardRoute}&many-options`);
  const card = page
    .getByRole("region", { name: "Inbox column", exact: true })
    .locator(".kanban-card")
    .first();
  const title = await card.locator(".task-row-title").innerText();
  const destination = page
    .getByRole("navigation", { name: "Board columns" })
    .getByRole("button", { name: "Shipped 5", exact: true });
  await destination.scrollIntoViewIfNeeded();
  const source = (await card.boundingBox())!;
  const target = (await destination.boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + 20);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 12, source.y + 25, {
    steps: 4,
  });
  await expect(page.locator(".kanban-drag-preview")).toBeVisible();
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + target.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
  await expect(
    page
      .getByRole("region", { name: "Shipped column", exact: true })
      .getByRole("button", { name: title, exact: true }),
  ).toBeVisible();
});
