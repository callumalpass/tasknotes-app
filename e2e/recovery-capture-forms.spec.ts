import { expect, test, type Page, type TestInfo } from "./local-test";

async function prepare(page: Page, info: TestInfo, many = false) {
  await page.setViewportSize({
    width: info.project.name === "mobile" ? 412 : 1280,
    height: 713,
  });
  await page.goto(`?demo=60${many ? "&many-options" : ""}`);
  await expect(
    page.getByRole("button", {
      name: "Prepare quarterly planning session",
      exact: true,
    }),
  ).toBeVisible();
}

async function capture(page: Page) {
  await page
    .getByRole("button", { name: "New task", exact: true })
    .filter({ visible: true })
    .click();
  return page.getByRole("dialog", { name: "New task", exact: true });
}

for (const theme of ["light", "dark"] as const) {
  test(`detail completion and reopening share visible and keyboard Undo, ${theme}`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: theme });
    await prepare(page, info);
    await page
      .getByRole("button", {
        name: "Prepare quarterly planning session",
        exact: true,
      })
      .click();
    const pane = page.getByRole("complementary", {
      name: "Task details",
      exact: true,
    });
    const path = new URL(page.url()).pathname;
    await pane
      .getByRole("button", { name: "Complete task", exact: true })
      .click();
    const notice = page.locator(".task-completed-notice");
    await expect(notice).toContainText(
      "Completed “Prepare quarterly planning session”",
    );
    await page.keyboard.press("Control+z");
    await expect(
      pane.getByRole("button", { name: "Complete task", exact: true }),
    ).toBeVisible();
    await pane
      .getByRole("button", { name: "Complete task", exact: true })
      .click();
    await pane
      .getByRole("button", { name: "Reopen task", exact: true })
      .click();
    await expect(notice).toContainText(
      "Reopened “Prepare quarterly planning session”",
    );
    await notice.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(
      pane.getByRole("button", { name: "Reopen task", exact: true }),
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(path);
    await page.screenshot({
      path: info.outputPath(`detail-undo-${theme}.png`),
    });
  });

  test(`capture has direct notes, legible times, stable long pickers and compact notice, ${theme}`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: theme });
    await prepare(page, info, true);
    const dialog = await capture(page);
    const input = dialog.getByRole("combobox", { name: "New task title" });
    await input.fill("Write release context tomorrow 9am");
    await dialog.getByRole("button", { name: "Notes", exact: true }).click();
    const notes = dialog.getByRole("textbox", { name: "Notes", exact: true });
    await expect(notes).toBeFocused();
    await notes.fill("One sentence of useful context.");
    await expect(
      dialog.getByRole("spinbutton", { name: "Estimate (minutes)" }),
    ).toHaveCount(0);
    await dialog
      .locator(".capture-targeted-edit")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Add details", exact: true })
      .click();
    await expect(
      dialog.getByRole("spinbutton", { name: "Estimate (minutes)" }),
    ).toBeVisible();
    for (const name of ["Scheduled time", "Due time"]) {
      const time = dialog.getByRole("button", { name, exact: true });
      expect((await time.boundingBox())!.width).toBeGreaterThanOrEqual(124);
      expect(
        await time
          .locator("span")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
    }
    await page.screenshot({
      path: info.outputPath(`capture-times-${theme}.png`),
    });
    await dialog.getByText("Organize", { exact: true }).click();
    await dialog
      .getByRole("combobox", { name: "Priority", exact: true })
      .click();
    const picker = page.locator(".tasknotes-select-popover:visible");
    const filter = picker.getByRole("combobox", {
      name: "Filter Priority",
      exact: true,
    });
    await picker.evaluate(async (element) => {
      await Promise.all(
        element.getAnimations().map((animation) => animation.finished),
      );
    });
    const before = await filter.boundingBox();
    const pickerBefore = await picker.boundingBox();
    await filter.fill("Someday");
    await expect(picker.getByRole("option")).toHaveCount(1);
    expect(
      Math.abs((await filter.boundingBox())!.y - before!.y),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs((await picker.boundingBox())!.height - pickerBefore!.height),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: info.outputPath(`picker-filter-${theme}.png`),
    });
    await picker.getByRole("option", { name: "Someday", exact: true }).click();
    const title =
      "An intentionally long captured title with the complete planning background and every supporting decision preserved for later review without making the confirmation unnecessarily tall";
    await input.fill(title);
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    const notice = page.locator(".task-added-notice");
    await expect(notice).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: `Task added: ${title}` }),
    ).toBeAttached();
    if (info.project.name === "mobile") {
      const message = await notice.locator(":scope > span").boundingBox();
      const actions = await notice.locator(".task-added-actions").boundingBox();
      expect(actions!.y).toBeGreaterThanOrEqual(message!.y + message!.height);
      expect(actions!.height).toBeGreaterThanOrEqual(44);
      expect(
        (await notice.locator(".task-added-title").boundingBox())!.height,
      ).toBeLessThanOrEqual(46);
    }
    await page.screenshot({
      path: info.outputPath(`added-notice-${theme}.png`),
    });
  });

  test(`Scratchpad menus dismiss and conversion starts with the current draft only, ${theme}`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: theme });
    await prepare(page, info, true);
    await page.goto("scratchpad/?demo=60&many-options");
    const empty = page
      .getByRole("textbox", { name: "Draft task: empty", exact: true })
      .last();
    await empty.fill("First draft for review");
    await page
      .getByRole("textbox", {
        name: "Draft task: First draft for review",
        exact: true,
      })
      .press("Enter");
    const second = page
      .getByRole("textbox", { name: "Draft task: empty", exact: true })
      .last();
    await second.fill("Current draft for review");
    const current = page.getByRole("textbox", {
      name: "Draft task: Current draft for review",
      exact: true,
    });
    const trigger = page.getByRole("button", {
      name: "Actions for Current draft for review",
      exact: true,
    });
    await trigger.click();
    await expect(
      page.getByRole("menu", {
        name: "Actions for Current draft for review",
        exact: true,
      }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("menu", {
        name: "Actions for Current draft for review",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.getByRole("button", { name: "Add image", exact: true }).click();
    await expect(
      page.getByRole("menu", {
        name: "Actions for Current draft for review",
        exact: true,
      }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Add image", exact: true }).click();
    await current.focus();
    await page
      .getByRole("button", { name: "Create task notes", exact: true })
      .click();
    const review = page.getByRole("dialog", {
      name: "Create task notes",
      exact: true,
    });
    await expect(review).toContainText("1 of");
    await expect(
      review.getByRole("checkbox", {
        name: "Current draft for review",
        exact: true,
      }),
    ).toBeChecked();
    await expect(
      review.getByRole("checkbox", {
        name: "First draft for review",
        exact: true,
      }),
    ).not.toBeChecked();
    await page.screenshot({
      path: info.outputPath(`scratchpad-review-${theme}.png`),
    });
  });

  test(`task-action panels use edge-to-edge phone sheets and views link to management, ${theme}`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: theme });
    await prepare(page, info, true);
    await page.locator('summary[aria-label="View options"]').click();
    await page
      .getByRole("button", { name: "Manage views", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Views", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/views\/?(?:\?|$)/);
    await prepare(page, info, true);
    const trigger = page.getByRole("button", {
      name: "Task actions for Prepare quarterly planning session",
      exact: true,
    });
    for (const panel of ["root", "Organize", "Copy", "Delete"]) {
      await trigger.click();
      if (panel !== "root")
        await page.getByRole("menuitem", { name: panel, exact: true }).click();
      const sheet = page.locator(".task-actions-menu");
      await expect(sheet).toBeVisible();
      await sheet.evaluate(async (element) => {
        await Promise.all(
          element.getAnimations().map((animation) => animation.finished),
        );
      });
      if (info.project.name === "mobile") {
        const bounds = await sheet.boundingBox();
        expect(bounds!.x).toBe(0);
        expect(bounds!.width).toBe(412);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(714);
      }
      await page.screenshot({
        path: info.outputPath(`actions-${panel}-${theme}.png`),
      });
      await page.keyboard.press("Escape");
      if (panel !== "root") {
        await expect(
          page.getByRole("menuitem", { name: "Organize", exact: true }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
      }
      await expect(sheet).toHaveCount(0);
    }
  });
}
