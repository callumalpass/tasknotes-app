import { expect, test } from "./local-test";

// Disposable in-memory demo only: never opens a Connect authority or LAB.
const focusedRowTitle = (page: import("@playwright/test").Page) =>
  page.locator(".task-row-title:focus");
const openDemo = async (page: import("@playwright/test").Page) => {
  await page.goto("?demo=50");
  await expect(
    page.getByRole("button", {
      name: "Send the research summary to Rowan",
      exact: true,
    }),
  ).toBeVisible();
};

test("j and k move between rows and row keys act on the focused task", async ({
  page,
}) => {
  await page.goto("?demo=50");
  const first = page.getByRole("button", {
    name: "Send the research summary to Rowan",
    exact: true,
  });
  await expect(first).toBeVisible();
  await page.locator("body").press("j");
  await expect(first).toBeFocused();
  await page.keyboard.press("j");
  const second = await focusedRowTitle(page).textContent();
  expect(second).not.toBe("Send the research summary to Rowan");
  await page.keyboard.press("k");
  await expect(first).toBeFocused();

  // Moving the task out of Today keeps focus in the list and announces it.
  await page.keyboard.press("m");
  await expect(
    page.getByText(
      "Scheduled Send the research summary to Rowan for tomorrow.",
    ),
  ).toBeAttached();
  await expect(first).toBeHidden();
  await expect(focusedRowTitle(page)).toHaveCount(1);

  const target = (await focusedRowTitle(page).textContent())!;
  await page.keyboard.press("x");
  await expect(page.getByText(`Completed ${target}.`)).toBeAttached();
});

test("row keys never fire while typing or with modifiers", async ({ page }) => {
  await page.goto("?demo=50");
  const first = page.getByRole("button", {
    name: "Send the research summary to Rowan",
    exact: true,
  });
  await first.focus();
  await page.keyboard.press("Alt+x");
  await page.keyboard.press("Shift+X");
  await expect(first).toBeVisible();
  await expect(page.locator("[aria-live='polite']").last()).toBeEmpty();

  await page.keyboard.press("ControlOrMeta+k");
  const search = page.getByRole("combobox", {
    name: "Search commands and tasks",
  });
  await search.fill("jxtm");
  await expect(search).toHaveValue("jxtm");
  await expect(first).toBeAttached();
});

test("the command palette navigates, acts on the focused task, and finds tasks", async ({
  page,
  isMobile,
}) => {
  await openDemo(page);
  await page.locator("body").press("j");
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("option", { name: /Complete “Send the research/ }),
  ).toBeVisible();
  const search = dialog.getByRole("combobox");
  await search.fill("cal");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();

  if (!isMobile) {
    await page.getByRole("button", { name: /^Commands/ }).click();
    await expect(dialog).toBeVisible();
  } else await page.keyboard.press("ControlOrMeta+k");
  await search.fill("quarterly");
  const result = dialog.getByRole("option", {
    name: "Prepare quarterly planning session",
  });
  await expect(result).toBeVisible();
  await result.click();
  await expect(
    page.getByRole("complementary", { name: "Task details" }),
  ).toContainText("Prepare quarterly planning session");

  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("? opens the shortcut sheet, which lists the global keys", async ({
  page,
}) => {
  await openDemo(page);
  await page.locator("body").press("?");
  const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(sheet).toBeVisible();
  for (const description of [
    "Command palette",
    "New task",
    "Undo a deleted task",
    "Schedule next week",
  ])
    await expect(sheet).toContainText(description);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});
