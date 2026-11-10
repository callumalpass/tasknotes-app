import { expect, test, type Page, type TestInfo } from "./local-test";
import { outlineOf } from "./scratchpad-editor";

async function prepare(page: Page, info: TestInfo) {
  await page.setViewportSize({
    width: info.project.name === "mobile" ? 412 : 1280,
    height: 713,
  });
  await page.goto("?demo=60");
  await expect(
    page.getByRole("button", {
      name: "Prepare quarterly planning session",
      exact: true,
    }),
  ).toBeVisible();
}

for (const theme of ["light"] as const) {
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
  });

  test(`Scratchpad menus dismiss and conversion starts with the current draft only, ${theme}`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: theme });
    await prepare(page, info);
    await page.goto("scratchpad/?demo=60");
    await expect(
      outlineOf(page.locator(".scratchpad-current-document")),
    ).toBeFocused();
    await page.getByRole("button", { name: "Earlier notes" }).click();
    // A past note keeps its actions in a menu on its line.
    const trigger = page
      .getByRole("button", { name: "Note actions", exact: true })
      .first();
    const menu = page.getByRole("menu", { name: "Note actions", exact: true });
    await trigger.click();
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(menu).toBeVisible();
    await page.getByRole("button", { name: "Add image", exact: true }).click();
    await expect(menu).toHaveCount(0);
    await page.getByRole("button", { name: "Add image", exact: true }).click();

    await page.getByRole("button", { name: "New note", exact: true }).click();
    const current = outlineOf(page.locator(".scratchpad-current-document"));
    await expect(current).toBeFocused();
    await page.keyboard.type("First draft for review");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Current draft for review");
    await page
      .getByRole("button", { name: "Create tasks", exact: true })
      .click();
    const review = page.getByRole("dialog", {
      name: "Create tasks",
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
  });
}
