import { expect, test } from "./local-test";

for (const theme of ["light", "dark"] as const) {
  for (const many of [false, true]) {
    test(`LIST B capture, detail, menu and Search: ${theme}, many=${many}`, async ({
      page,
      isMobile,
    }, info) => {
      await page.setViewportSize({ width: isMobile ? 412 : 1280, height: 713 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`?demo=60${many ? "&many-options" : ""}`);
      await expect(page.locator(".task-row-title").first()).toBeVisible();
      await page.locator(".task-row-title").first().click();
      const pane = page.locator(".task-screen");
      const notes = pane.locator(".notes-field-heading");
      await pane
        .getByRole("button", { name: "Edit Project", exact: true })
        .scrollIntoViewIfNeeded();
      const before = await notes.evaluate(
        (element) => (element as HTMLElement).offsetTop,
      );
      await pane
        .getByRole("button", { name: "Edit Project", exact: true })
        .click();
      await expect(
        pane.getByRole("combobox", { name: "Project", exact: true }),
      ).toBeFocused();
      const after = await notes.evaluate(
        (element) => (element as HTMLElement).offsetTop,
      );
      expect(Math.abs(before - after)).toBeLessThan(2);
      await expect(pane.locator(".task-inline-property-editor")).toHaveCSS(
        "height",
        "44px",
      );
      await page.screenshot({
        path: info.outputPath("detail-project.png"),
        animations: "disabled",
      });
      await pane.getByRole("button", { name: "Done", exact: true }).click();
      await pane.getByRole("link", { name: "Notes", exact: true }).click();
      await expect(pane.locator("#task-notes-title")).toBeFocused();
      await expect(pane.locator("#task-notes-title")).toHaveCSS(
        "font-weight",
        "600",
      );
      await page.goto(`?demo=60${many ? "&many-options" : ""}`);
      await page.locator(".task-actions-trigger").first().click();
      const menu = page.locator(".task-actions-menu").first();
      await expect(menu).toBeVisible();
      expect(
        await menu.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      if (isMobile)
        await expect(
          page.locator(".task-actions-quick-priority").first(),
        ).toBeHidden();
      await page.screenshot({
        path: info.outputPath("menu.png"),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      if (isMobile) await page.locator(".view-context-capture").click();
      else
        await page
          .getByRole("button", { name: "New task", exact: true })
          .click();
      const capture = page.getByRole("dialog", {
        name: "New task",
        exact: true,
      });
      const input = capture.getByRole("combobox", { name: "New task title" });
      await expect(input).toHaveAttribute("placeholder", "What needs doing?");
      await input.fill("Review +[[Field research]] tomorrow 9am");
      await expect(capture.locator(".capture-link-bracket").first()).toHaveCSS(
        "visibility",
        "hidden",
      );
      const close = await capture
        .getByRole("button", { name: "Close new task" })
        .boundingBox();
      const dialog = await capture.boundingBox();
      expect(close!.y - dialog!.y).toBeLessThan(10);
      expect(Math.round(close!.height)).toBeGreaterThanOrEqual(44);
      const keepAdding = capture.getByRole("checkbox", {
        name: "Keep adding tasks",
      });
      await expect(keepAdding).toHaveCSS("width", "18px");
      await expect(keepAdding).toHaveCSS("border-radius", "4px");
      await keepAdding.uncheck();
      const uncheckedBackground = await keepAdding.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      await keepAdding.check();
      await expect(keepAdding).toBeChecked();
      await expect(keepAdding).not.toHaveCSS(
        "background-color",
        uncheckedBackground,
      );
      await page.screenshot({
        path: info.outputPath("capture.png"),
        animations: "disabled",
      });
      await capture.getByRole("button", { name: "Close new task" }).click();
      await page.goto(`search?demo=60${many ? "&many-options" : ""}`);
      const search = page.getByRole("searchbox", { name: "Search tasks" });
      await search.fill("quarterly");
      await expect(
        page.locator(".search-results .task-row-title").first(),
      ).toBeVisible();
      await search.press("Enter");
      await expect(
        page.locator(".search-results .task-row-title").first(),
      ).toBeFocused();
      await expect(page.locator("#search-navigation-hint")).toBeVisible();
      await page.screenshot({
        path: info.outputPath("search.png"),
        animations: "disabled",
      });
      await page.goto(`more/device?demo=60${many ? "&many-options" : ""}`);
      const themeChoice = page
        .locator(".theme-picker .tasknotes-control-trigger")
        .first();
      await expect(themeChoice).toHaveCSS("min-height", "44px");
      await expect(themeChoice).toHaveCSS("border-radius", "6px");
      await page.screenshot({
        path: info.outputPath("device-settings.png"),
        animations: "disabled",
      });
      await page.goto(`more/behavior?demo=60${many ? "&many-options" : ""}`);
      const defaultStatus = page.getByRole("combobox", {
        name: "Default status",
        exact: true,
      });
      await defaultStatus.scrollIntoViewIfNeeded();
      await expect(defaultStatus).toHaveCSS("min-height", "44px");
      await expect(defaultStatus).toHaveCSS("border-radius", "6px");
      await expect(defaultStatus).toHaveCSS("border-top-width", "1px");
      await defaultStatus.click();
      await expect(page.getByRole("listbox")).toBeVisible();
      const filter = page.getByRole("combobox", {
        name: "Filter Default status",
        exact: true,
      });
      await expect(filter).toHaveCSS("border-top-width", "1px");
      await expect(filter).toHaveCSS("padding-left", "12px");
      await page.screenshot({
        path: info.outputPath("collection-choices.png"),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await page.goto(`views?demo=60${many ? "&many-options" : ""}`);
      await page
        .getByRole("button", { name: "Create view", exact: true })
        .click();
      const editor = page.getByRole("dialog");
      for (const selector of [
        ".view-draft-preview",
        ".view-layout-disclosure",
      ]) {
        const disclosure = editor.locator(selector);
        const glyph = disclosure.locator("summary > svg");
        await expect(glyph).toHaveAttribute("width", "16");
        await expect(glyph).toHaveCSS("transform", "matrix(0, -1, 1, 0, 0, 0)");
        await disclosure.locator("summary").click();
        await expect(glyph).toHaveCSS("transform", "none");
      }
      await page.screenshot({
        path: info.outputPath("view-disclosures.png"),
        animations: "disabled",
      });
      await editor.locator('[aria-controls="view-filter-content"]').click();
      const filterEditor = editor.locator(".expression-builder");
      await filterEditor
        .getByRole("button", { name: "Advanced", exact: true })
        .click();
      const source = 'note["status"] == "open" && file.hasTag("work")';
      const expression = filterEditor.getByRole("textbox", {
        name: "Filter expression",
      });
      await expression.fill(source);
      await expect(
        filterEditor.getByRole("button", { name: "Builder", exact: true }),
      ).toBeDisabled();
      await expect(filterEditor.locator(".expression-mode-note")).toContainText(
        "Has tag work",
      );
      await expect(filterEditor.locator(".expression-mode-note")).toContainText(
        "The builder cannot represent every condition",
      );
      await editor
        .getByRole("textbox", { name: "View name", exact: true })
        .fill("Retained filter preview");
      await expect(expression).toHaveValue(source);
      await filterEditor
        .locator(".expression-mode-note")
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath("unsupported-filter.png"),
        animations: "disabled",
      });
    });
  }
}

test("selected scheduling requires a due-date decision and preserves Due when kept", async ({
  page,
}) => {
  await page.goto("?demo=60");
  const first = page.locator(".task-row").filter({
    has: page.getByRole("button", {
      name: "Prepare quarterly planning session",
      exact: true,
    }),
  });
  const due = await first
    .locator(".task-row-property.is-date")
    .filter({ hasText: "Due" })
    .textContent();
  await first.locator(".task-row-title").focus();
  await page.keyboard.press("v");
  await page.locator(".task-row-title").nth(2).focus();
  await page.keyboard.press("v");
  await page.getByRole("combobox", { name: "Schedule selected tasks" }).click();
  await page.getByRole("option", { name: "Tomorrow", exact: true }).click();
  await expect(page.locator(".bulk-update-notice")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Keep due dates", exact: true })
    .click();
  await expect(page.locator(".bulk-update-notice")).toContainText(
    "Scheduled 2 tasks for Tomorrow",
  );
  await expect(
    first.locator(".task-row-property.is-date").filter({ hasText: "Due" }),
  ).toHaveText(due!);
  await expect(page.locator(".bulk-update-notice > span")).toHaveCSS(
    "-webkit-line-clamp",
    "none",
  );
  await expect(
    page
      .locator(".bulk-update-notice")
      .getByRole("button", { name: "Undo", exact: true }),
  ).toBeInViewport();
});
