import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
const view = (id: string) =>
  `views/${encodeURIComponent(`TaskNotes/Views/${id}.base#${id}`)}?demo=50`;

test("mobile writing does not remove navigation without an onscreen keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("scratchpad?demo=50");
  await expect(page.locator(".scratchpad-row textarea").last()).toBeFocused();
  await expect(page.locator(".bottom-navigation")).toBeVisible();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
});

test("priority labels are readable in search, projects, and expanded task properties", async ({
  page,
}) => {
  for (const route of ["search?demo=50", view("projects"), "?demo=50"]) {
    await page.goto(route);
    if (route.startsWith("search")) {
      await page.getByRole("searchbox").fill("Review");
      await expect(page.locator(".task-row-title").first()).toBeVisible();
    } else if (route.startsWith("views"))
      await expect(
        page.getByRole("heading", { name: /^Field research/ }),
      ).toBeVisible();
    else {
      await page
        .getByRole("button", {
          name: "Prepare quarterly planning session",
          exact: true,
        })
        .click();
      await page.locator("details").evaluateAll((nodes) =>
        nodes.forEach((node) => {
          node.open = true;
        }),
      );
    }
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      scan.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      ),
    ).toEqual([]);
  }
});

test("calendar More targets work at desktop and phone widths", async ({
  page,
}) => {
  await page.goto(view("calendar"));
  await expect(page.locator(".fc-more-link").first()).toBeVisible();
  const sizes = await page.locator(".fc-more-link").evaluateAll((nodes) =>
    nodes.map((node) => ({
      width: node.getBoundingClientRect().width,
      height: node.getBoundingClientRect().height,
    })),
  );
  expect(sizes.length).toBeGreaterThan(0);
  expect(sizes.every((size) => size.width >= 44 && size.height >= 44)).toBe(
    true,
  );
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag22aa"]).analyze())
      .violations,
  ).toEqual([]);
});

test("task titles have real touch targets without overlapping metadata", async ({
  page,
}) => {
  await page.goto("?demo=50");
  const title = page.getByRole("button", {
    name: "Book the project room",
    exact: true,
  });
  await expect(title).toBeVisible();
  const box = await title.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await title.click({ position: { x: box!.width / 2, y: box!.height - 2 } });
  await expect(
    page.getByRole("textbox", { name: "Task title", exact: true }),
  ).toHaveValue("Book the project room");
});

test("phone Scratchpad reserves writing width and keeps conversion in the row menu", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("scratchpad?demo=50");
  const input = page.getByRole("textbox", {
    name: "Draft task: Ask Rowan about the research notes",
    exact: true,
  });
  await expect(input).toBeVisible();
  expect((await input.boundingBox())!.width).toBeGreaterThanOrEqual(190);
  const row = input.locator("xpath=../..");
  for (const selector of [
    ".scratchpad-collapse",
    ".scratchpad-draft-completion",
    ".scratchpad-row-menu-trigger",
  ]) {
    const box = await row.locator(selector).boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await row
    .getByRole("button", {
      name: "Actions for Ask Rowan about the research notes",
      exact: true,
    })
    .click();
  await row
    .getByRole("menuitem", { name: "Keep as note", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", {
      name: "Note: Ask Rowan about the research notes",
      exact: true,
    }),
  ).toHaveValue("Ask Rowan about the research notes");
});

test("Browse dismisses on Tab and no longer owns background arrow keys", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?demo=50");
  const browse = page.getByRole("button", { name: "Browse", exact: true });
  await browse.click();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("menu", { name: "Browse" })).toHaveCount(0);
  const active = await page.evaluate(() => document.activeElement?.outerHTML);
  await page.keyboard.press("ArrowDown");
  expect(await page.evaluate(() => document.activeElement?.outerHTML)).toBe(
    active,
  );
  await browse.click();
  await page.keyboard.press("Escape");
  await expect(browse).toBeFocused();
});
test("calendar overflow owns focus and restores More on Escape", async ({
  page,
}) => {
  await page.goto(view("calendar"));
  const more = page.locator(".fc-more-link").first();
  await more.focus();
  await page.keyboard.press("Enter");
  const popup = page.getByRole("dialog");
  await expect(popup).toBeVisible();
  expect(
    await popup.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Tab");
  expect(
    await popup.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await expect(more).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(popup).toBeVisible();
  await popup.getByRole("button", { name: "Close additional tasks" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(popup).toHaveCount(0);
  await more.focus();
  await page.keyboard.press("Enter");
  await popup.getByRole("button", { name: "Close additional tasks" }).focus();
  await page.keyboard.press("Enter");
  await expect(popup).toHaveCount(0);
  await expect(more).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(popup).toBeVisible();
  await popup.locator(".full-calendar-event-content").first().focus();
  await page.keyboard.press("Enter");
  await expect(popup).toHaveCount(0);
  await expect(
    page.getByRole("complementary", { name: "Task details" }),
  ).toBeFocused();
});
test("phone calendar has one capture action and preserves the selected date", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(view("calendar"));
  const day = page.locator(".fc-daygrid-day:not(.fc-day-other)").first();
  await day.locator(".fc-daygrid-day-top").click();
  await expect(
    page.getByRole("dialog", { name: "New task", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "New task", exact: true }),
  ).toHaveCount(1);
  await expect(page.locator(".full-calendar-create")).toBeHidden();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  const capture = page.getByRole("dialog", { name: "New task", exact: true });
  await capture
    .getByRole("combobox", { name: "New task title" })
    .fill("Calendar context regression");
  await capture.getByRole("button", { name: "Add", exact: true }).click();
  await expect(capture).toHaveCount(0);
  await expect(
    page
      .getByRole("complementary", { name: "Selected day" })
      .getByRole("button", {
        name: "Calendar context regression",
        exact: true,
      }),
  ).toBeVisible();
});

test("projects remember collapsing and provide a focused jump", async ({
  page,
}) => {
  await page.goto(view("projects"));
  const group = page.locator(".project-group").first();
  const toggle = group.locator(".project-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(group.locator(".task-row")).toHaveCount(0);
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page
    .getByRole("combobox", { name: "Jump to project" })
    .selectOption("0");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toBeFocused();
  await expect(group.locator(".task-row").first()).toBeVisible();
});
test("search explains note matches without altering the query", async ({
  page,
}) => {
  await page.goto("search?demo=50");
  await page
    .getByRole("searchbox", { name: "Search tasks" })
    .fill("supporting");
  const context = page.locator(".task-row-context").first();
  await expect(context).toContainText("Matched in notes");
  await expect(
    context.locator("..").locator(".task-row-title"),
  ).toHaveAccessibleDescription(/Matched in notes/);
});
test("Archive capture acknowledges the accepted task without moving the view", async ({
  page,
}) => {
  await page.goto(view("archive"));
  await expect(
    page.getByRole("heading", { name: "No archived tasks here." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  const capture = page.getByRole("dialog", { name: "New task" });
  await capture
    .getByRole("combobox", { name: "New task title" })
    .fill("Archive capture confirmation");
  await capture.getByRole("button", { name: "Add", exact: true }).click();
  await expect(capture).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "No archived tasks here." }),
  ).toBeVisible();
  const notice = page.locator(".task-added-notice");
  await expect(notice).toContainText("Archive capture confirmation");
  await notice.getByRole("button", { name: "Open", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Task title", exact: true }),
  ).toHaveValue("Archive capture confirmation");
  await expect(notice).toHaveCount(0);
});
test("phone view editor leads with controls and identifies Planner as external", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("views?demo=50");
  await page.getByRole("button", { name: "Create view", exact: true }).click();
  const editor = page.getByRole("dialog");
  await expect(editor.locator(".view-draft-preview")).not.toHaveAttribute(
    "open",
  );
  await expect(editor.locator(".view-layout-disclosure")).not.toHaveAttribute(
    "open",
  );
  const filter = editor.getByRole("heading", { name: "Filter", exact: true });
  await expect(filter).toBeVisible();
  expect((await filter.boundingBox())!.y).toBeLessThan(700);
  await editor.locator(".view-layout-disclosure > summary").click();
  await editor.getByRole("radio", { name: "Planner", exact: true }).check();
  await expect(editor.locator(".view-planner-explanation")).toContainText(
    "Planner is a separate app",
  );
});
test("task summaries use readable project labels and settings show the build version", async ({
  page,
}) => {
  await page.goto("?demo=50");
  await page
    .getByRole("button", {
      name: "Prepare quarterly planning session",
      exact: true,
    })
    .click();
  const organize = page
    .locator(".task-form-section > summary")
    .filter({ hasText: "Organize" });
  await expect(organize).toContainText("Product refresh");
  await expect(organize).not.toContainText("[[");
  await page.goto("more?demo=50");
  const { version } = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  await expect(
    page.getByText(`Version ${version}`, { exact: true }),
  ).toBeVisible();
});

test("working screens reflow at 320px with 200% text", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const cases = [
    ["?demo=50", "button.task-row-title"],
    [view("upcoming"), ".fc-view"],
    [view("calendar"), ".fc-view"],
    [view("projects"), ".project-group"],
    [view("work-board"), ".kanban-column"],
    ["search?demo=50", ".browse-fields button"],
    ["scratchpad?demo=50", ".scratchpad-row"],
    ["more?demo=50", ".setting-row"],
    ["views?demo=50", ".view-catalog"],
  ];
  for (const [route, ready] of cases) {
    await page.goto(route);
    await expect(page.locator(ready).first()).toBeVisible();
    if (route.startsWith("more"))
      await page.locator("details").evaluateAll((nodes) =>
        nodes.forEach((node) => {
          node.open = true;
        }),
      );
    await page.addStyleTag({ content: ":root {font-size:200% !important}" });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth), {
        message: route,
      })
      .toBeLessThanOrEqual(320);
  }
});

test("view editor actions remain onscreen at 320px and 200% text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("views?demo=50");
  await page
    .getByRole("button", { name: "More actions for Today", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "View name" }).fill("Daily focus");
  await page.addStyleTag({ content: ":root {font-size:200% !important}" });
  const dialog = page.getByRole("dialog");
  for (const name of ["Close view editor", "Cancel", "Save view"]) {
    const control = dialog.getByRole("button", { name, exact: true });
    await expect(control).toBeVisible();
    const rect = await control.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(321);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(845);
  }
});
