import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./local-test";

const view = (id: string) =>
  `views/${encodeURIComponent(`TaskNotes/Views/${id}.base#${id}`)}?demo=50`;

async function dragBetween(page: Page, from: Locator, to: Locator) {
  const start = (await from.boundingBox())!;
  const end = (await to.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    start.x + start.width / 2,
    start.y + start.height / 2 + 12,
    { steps: 3 },
  );
  await page.mouse.move(
    end.x + end.width / 2,
    end.y + Math.min(end.height * 0.75, 100),
    { steps: 8 },
  );
  await page.mouse.up();
}

test.skip(
  ({ isMobile }) => isMobile,
  "Touch drags by the handle or a long press",
);

test("list rows drag by their title and still open on click", async ({
  page,
}) => {
  await page.goto("?demo=50");
  await expect(page.locator("[data-manual-order-task]").first()).toBeVisible();
  const lane = await page.evaluate(() => {
    const counts = new Map<string, number>();
    for (const node of document.querySelectorAll<HTMLElement>(
      "[data-manual-order-task]",
    )) {
      const key = node.dataset.listLane ?? "";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts].find(([, count]) => count > 1)?.[0];
  });
  expect(lane).toBeDefined();
  const rows = page.locator(
    `[data-manual-order-task][data-list-lane="${lane}"]`,
  );
  const title = rows.first().locator(".task-row-title");
  const before = await rows.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-manual-order-task")),
  );
  const target = rows.nth(before.length - 1);

  await dragBetween(page, title, target);
  await expect
    .poll(() =>
      rows.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-manual-order-task")),
      ),
    )
    .not.toEqual(before);
  await expect(
    page.getByRole("complementary", { name: "Task details" }),
  ).toHaveCount(0);

  await title.click();
  await expect(
    page.getByRole("complementary", { name: "Task details" }),
  ).toBeVisible();
});

test("kanban cards drag by their title", async ({ page }) => {
  await page.goto(view("work-board"));
  const card = page.locator(".kanban-card.is-movable").first();
  await expect(card).toBeVisible();
  const id = await card.getAttribute("data-kanban-card-id");
  const source = card.locator("xpath=ancestor::section[1]");
  const sourceName = await source.getAttribute("aria-label");
  const destination = page
    .locator("section.kanban-column")
    .filter({ hasNot: page.locator(`[data-kanban-card-id="${id}"]`) })
    .first();
  const destinationName = await destination.getAttribute("aria-label");
  expect(destinationName).not.toEqual(sourceName);

  await dragBetween(page, card.locator(".task-row-title"), destination);
  await expect(
    page
      .locator("section.kanban-column")
      .filter({ has: page.locator(`[data-kanban-card-id="${id}"]`) }),
  ).toHaveAttribute("aria-label", destinationName!);
  await expect(
    page.getByRole("complementary", { name: "Task details" }),
  ).toHaveCount(0);
});
