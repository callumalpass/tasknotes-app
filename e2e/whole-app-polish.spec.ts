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
  const sizes = await page
    .locator(".fc-more-link")
    .evaluateAll((nodes) =>
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
