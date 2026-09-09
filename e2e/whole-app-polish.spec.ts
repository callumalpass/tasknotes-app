import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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
        page.getByRole("heading", { name: "Field research", exact: true }),
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
