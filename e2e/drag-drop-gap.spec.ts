import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./local-test";

const view = (id: string) =>
  `views/${encodeURIComponent(`TaskNotes/Views/${id}.base#${id}`)}?demo=50`;

test.skip(
  ({ isMobile }) => isMobile,
  "Touch drags by the handle or a long press",
);

async function ids(locator: Locator, attribute: string) {
  return locator.evaluateAll(
    (nodes, name) => nodes.map((node) => node.getAttribute(name)),
    attribute,
  );
}

async function busiestLane(page: Page) {
  await expect(page.locator("[data-manual-order-task]").first()).toBeVisible();
  const lane = await page.evaluate(() => {
    const counts = new Map<string, number>();
    for (const node of document.querySelectorAll<HTMLElement>(
      "[data-manual-order-task]",
    )) {
      const key = node.dataset.listLane ?? "";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts].find(([, count]) => count > 3)?.[0];
  });
  expect(lane).toBeDefined();
  return page.locator(`[data-manual-order-task][data-list-lane="${lane}"]`);
}

async function pickUp(page: Page, from: Locator) {
  const box = (await from.boundingBox())!;
  await page.mouse.move(box.x + 24, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 24, box.y + box.height / 2 + 10, {
    steps: 3,
  });
}

async function tops(rows: Locator) {
  return rows.evaluateAll((nodes) =>
    nodes.map((node) => Math.round(node.getBoundingClientRect().top)),
  );
}

test("list rows part to open a gap where the dragged row will land", async ({
  page,
}) => {
  await page.goto("?demo=50");
  const rows = await busiestLane(page);
  const before = await ids(rows, "data-manual-order-task");
  const [dragged, second, third] = before;
  const target = (await rows.nth(2).boundingBox())!;

  await pickUp(page, rows.first().locator(".task-row-title"));
  await page.mouse.move(target.x + 24, target.y + target.height * 0.75, {
    steps: 10,
  });

  // The dragged row now waits in the slot after the third row.
  const expected = [second, third, dragged, ...before.slice(3)];
  await expect
    .poll(() => ids(rows, "data-manual-order-task"))
    .toEqual(expected);
  await expect(page.locator(".is-previewing-drop")).toHaveCount(1);
  await expect(page.locator(".manual-order-row.is-dragging")).toHaveAttribute(
    "data-manual-order-task",
    dragged!,
  );
  await expect(page.locator(".manual-order-row.is-drop-after")).toHaveCount(0);
  await expect
    .poll(() =>
      rows.evaluateAll(
        (nodes) => nodes.flatMap((node) => node.getAnimations()).length,
      ),
    )
    .toBe(0);
  const settled = await tops(rows);

  // Rows sliding under the pointer never move the drop: it is resolved from
  // where rows sat when the drag began.
  const pointer = { x: target.x + 24, y: target.y + target.height * 0.75 };
  for (const offset of [-6, 6, -10, 10, 0])
    await page.mouse.move(pointer.x, pointer.y + offset);
  expect(await ids(rows, "data-manual-order-task")).toEqual(expected);

  // The drop lands exactly where the preview showed, without a second glide.
  await page.mouse.up();
  expect(await ids(rows, "data-manual-order-task")).toEqual(expected);
  expect(await tops(rows)).toEqual(settled);
  await expect(page.locator(".is-previewing-drop")).toHaveCount(0);
});

test("reduced motion keeps rows still and marks the drop with a line", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("?demo=50");
  const rows = await busiestLane(page);
  const before = await ids(rows, "data-manual-order-task");
  const target = (await rows.nth(2).boundingBox())!;

  await pickUp(page, rows.first().locator(".task-row-title"));
  await page.mouse.move(target.x + 24, target.y + target.height * 0.75, {
    steps: 10,
  });
  // The slot between the third and fourth rows.
  await expect(rows.nth(3)).toHaveClass(/is-drop-before/);
  expect(await ids(rows, "data-manual-order-task")).toEqual(before);
  await expect(page.locator(".is-previewing-drop")).toHaveCount(0);

  await page.mouse.up();
  await expect
    .poll(() => ids(rows, "data-manual-order-task"))
    .toEqual([before[1], before[2], before[0], ...before.slice(3)]);
});

test("manually ordered board cards part in the destination column", async ({
  page,
}) => {
  await page.goto(view("work-board"));
  await expect(page.locator(".kanban-card").first()).toBeVisible();
  await page.getByLabel("View options", { exact: true }).click();
  await page.getByRole("button", { name: "Manual order" }).click();
  await page.keyboard.press("Escape");
  const columns = page.locator("section.kanban-column");
  const source = columns.nth(0).locator("[data-kanban-card-id]");
  // Columns are named, since they can reorder once a move settles.
  const destinationName = (await columns.nth(1).getAttribute("aria-label"))!;
  const destinationColumn = page.getByRole("region", {
    name: destinationName,
  });
  const destination = destinationColumn.locator("[data-kanban-card-id]");
  await expect(source.first()).toHaveAttribute(
    "aria-label",
    /Use arrow keys to arrange/,
  );
  const card = source.first();
  const dragged = (await card.getAttribute("data-kanban-card-id"))!;
  const title = (await card.locator(".task-row-title").innerText()).trim();
  const width = (await card.boundingBox())!.width;
  const destinationBefore = await ids(destination, "data-kanban-card-id");
  const target = (await destination.nth(1).boundingBox())!;

  await pickUp(page, card.locator(".task-row-title"));
  await page.mouse.move(target.x + 24, target.y + target.height * 0.3, {
    steps: 12,
  });

  // The card waits between the first and second cards of the new column.
  const expected = [
    destinationBefore[0],
    dragged,
    ...destinationBefore.slice(1),
  ];
  await expect
    .poll(() => ids(destination, "data-kanban-card-id"))
    .toEqual(expected);
  await expect(
    destinationColumn.locator(".kanban-card.is-dragging"),
  ).toHaveCount(1);
  await expect(page.locator(".kanban-card.is-drop-before")).toHaveCount(0);

  // The preview is a lifted copy of the card itself, not a title box.
  const preview = page.locator("[data-kanban-drag-preview]");
  await expect(preview).toHaveAttribute("aria-hidden", "true");
  await expect(preview.locator(".task-row-title")).toHaveText(title);
  expect(
    await preview.evaluate((node) => ({
      events: getComputedStyle(node).pointerEvents,
      shadow: getComputedStyle(node).boxShadow,
      identities: node.querySelectorAll("[data-task-id], [id], [tabindex]")
        .length,
    })),
  ).toEqual({
    events: "none",
    shadow: expect.stringContaining("px"),
    identities: 0,
  });
  expect(Math.round((await preview.boundingBox())!.width)).toBe(
    Math.round(width),
  );

  await page.mouse.up();
  await expect(preview).toHaveCount(0);
  await expect
    .poll(() => ids(destination, "data-kanban-card-id"))
    .toEqual(expected);
});
