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
  const first = page.locator(".task-row-title").first();
  await expect(first).toBeVisible();
  const firstLabel = await first.getAttribute("aria-label");
  await page.locator("body").press("j");
  await expect(first).toBeFocused();
  await page.keyboard.press("j");
  const second = await focusedRowTitle(page).getAttribute("aria-label");
  expect(second).not.toBe(firstLabel);
  await page.keyboard.press("k");
  await expect(first).toBeFocused();

  const scheduled = page.getByRole("button", {
    name: "Send the research summary to Rowan",
    exact: true,
  });
  await scheduled.focus();

  // Moving the task out of Today keeps focus in the list and announces it.
  await page.keyboard.press("m");
  await expect(
    page.getByText(
      "Scheduled Send the research summary to Rowan for tomorrow.",
    ),
  ).toBeAttached();
  await expect(scheduled).toBeHidden();
  await expect(focusedRowTitle(page)).toHaveCount(1);

  const target = (await focusedRowTitle(page).getAttribute("aria-label"))!;
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
  await page
    .getByRole("button", {
      name: "Send the research summary to Rowan",
      exact: true,
    })
    .focus();
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
    await page.getByRole("button", { name: /^Quick actions/ }).click();
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
    "Undo last action",
    "Schedule next week",
  ])
    await expect(sheet).toContainText(description);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

// Global reach must work with real row handlers, not just the shell listener.
test("plain capture, search, and g sequences respect typing and row actions", async ({
  page,
}) => {
  await openDemo(page);
  for (const key of ["q", "n"]) {
    await page.locator("body").press(key);
    const capture = page.getByRole("dialog", { name: "New task" });
    await expect(capture).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(capture).toBeHidden();
  }
  for (const [key, heading] of [
    ["u", "Upcoming"],
    ["s", "Scratchpad"],
    ["c", "Calendar"],
    ["p", "Projects"],
    ["t", "Today"],
  ]) {
    // Blur Scratchpad's editor before invoking a plain shortcut.
    await page.locator("#main-content").focus();
    await page.keyboard.press("g");
    await page.keyboard.press(key);
    await expect(
      page.getByRole("heading", { name: heading, exact: true }).first(),
    ).toBeVisible();
  }
  await page.locator("body").press("j");
  const firstTitle = await focusedRowTitle(page).getAttribute("aria-label");
  await page.keyboard.press("g");
  await page.keyboard.press("t");
  await expect(
    page.getByRole("button", { name: firstTitle!, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(`Scheduled ${firstTitle} for today.`),
  ).toHaveCount(0);
  await page.locator("#main-content").focus();
  await page.keyboard.press("/");
  const search = page.getByRole("searchbox", { name: "Search tasks" });
  await expect(search).toBeFocused();
  await search.fill("qn/gtm");
  await expect(search).toHaveValue("qn/gtm");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator("#main-content").focus();
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
});

test("row keys act on the whole selection and keep the list place", async ({
  page,
  isMobile,
}) => {
  await page.goto("?demo=60");
  await expect(page.locator("button.task-row-title").first()).toBeVisible();
  const rows = page.locator(".task-row[data-task-id]");
  const overdue = page.locator("#task-section-overdue .task-row");
  const first = await overdue.first().getAttribute("data-task-id");
  const nextId = await overdue.nth(2).getAttribute("data-task-id");
  const next = page.locator(`[data-task-id="${nextId}"] .task-row-title`);
  const original = await overdue.evaluateAll((elements) =>
    elements.slice(0, 2).map((element) => ({
      id: element.getAttribute("data-task-id"),
      description: element
        .querySelector(".task-row-title")!
        .getAttribute("aria-description"),
    })),
  );
  await overdue.first().locator(".task-row-title").focus();
  await page.keyboard.press("v");
  await page.keyboard.press("Shift+J");
  await expect(page.locator(".bulk-selection-count")).toContainText(
    "2 selected",
  );
  await page.keyboard.press("m");
  await expect(
    page.getByRole("group", { name: "Due dates that have passed" }),
  ).toContainText("1 due date has passed");
  await expect(page.locator(".bulk-update-notice")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Keep due dates", exact: true })
    .click();
  const moved = page.locator(`[data-task-id="${first}"]`);
  if (isMobile) {
    const metadata = moved.getByRole("button", {
      name: /^Properties for /,
    });
    await expect(metadata).toHaveAccessibleDescription(
      /Scheduled: Tomorrow.*Due: .*ago/,
    );
    await expect(metadata.locator('[data-property="scheduled"]')).toHaveText(
      /^Tomorrow(?:,|$)/,
    );
    await expect(metadata.locator('[data-property="due"]')).toContainText(
      "ago",
    );
  } else {
    await expect(
      moved.getByRole("button", { name: /^Scheduled: Tomorrow/ }),
    ).toBeVisible();
    await expect(
      moved.getByRole("button", { name: /^Due: .*ago/ }),
    ).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(page.locator(".app-shell")).not.toHaveClass(/sidebar-collapsed/);
  await expect(rows.locator(".task-row-title:focus")).toHaveCount(1);
  await expect(next).toBeFocused();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  for (const task of original) {
    await expect(
      page.locator(`[data-task-id="${task.id}"] .task-row-title`),
    ).toHaveAttribute("aria-description", task.description!);
  }
});

test("a single reschedule confirms itself with Undo", async ({ page }) => {
  await page.goto("?demo=60");
  const first = page.locator("button.task-row-title").first();
  await expect(first).toBeVisible();
  const title = (await first.getAttribute("aria-label"))!;
  await page.keyboard.press("j");
  await page.keyboard.press("m");
  const toast = page.locator(".undo-toast");
  await expect(toast).toContainText("tomorrow");
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(toast).toContainText("Undid change");
  await expect(page.getByRole("button", { name: title }).first()).toBeVisible();
});

test("priority and project keys open their pickers", async ({
  page,
  isMobile,
}) => {
  await page.goto("?demo=60");
  await expect(page.locator("button.task-row-title").first()).toBeVisible();
  await page.keyboard.press("j");
  await page.keyboard.press("p");
  await expect(page.getByRole("menuitemradio", { name: "High" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.locator("button.task-row-title").first().focus();
  await page.keyboard.press("+");
  if (isMobile) await page.locator(".multi-value-control input").click();
  await expect(page.locator(".multi-value-control input")).toBeFocused();
  await page.keyboard.type("Oper");
  await expect(
    page.getByRole("option", { name: "Operations" }).first(),
  ).toBeVisible();
});

test("plus moves the focused task to one project in a single step", async ({
  page,
  isMobile,
}) => {
  await page.goto("?demo=50");
  await expect(page.locator(".task-row-title").first()).toBeVisible();
  await page.keyboard.press("j");
  await page.keyboard.press("+");
  const search = page.getByRole("combobox", { name: "Project" });
  if (isMobile) await search.click();
  await expect(search).toBeFocused();
  await search.pressSequentially("Oper");
  await expect(page.getByRole("option", { name: "Operations" })).toBeVisible();
  await expect(search).toHaveAttribute("aria-activedescendant", /.+/);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText(/^Moved “.+” to Operations$/)).toBeVisible();
  await page.keyboard.press("+");
  await expect(
    page.getByRole("dialog", { name: "Move to project" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(page.locator(".task-row-title:focus")).toHaveCount(1);
});
