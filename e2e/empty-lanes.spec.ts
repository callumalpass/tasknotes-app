import { expect, test } from "./local-test";

test("empty day lanes use quiet UI text except during an active drag", async ({
  page,
}) => {
  await page.goto("?demo=1");
  await expect(
    page.getByText("Prepare quarterly planning session"),
  ).toBeVisible();
  const placeholders = page.locator(".task-list-empty-drop-zone");
  await expect(placeholders.first()).toHaveText("No tasks");
  await expect(page.getByText("Drop here", { exact: true })).toHaveCount(0);
  expect(
    await placeholders
      .first()
      .evaluate((element) => getComputedStyle(element).fontFamily),
  ).toContain("Atkinson Hyperlegible");
  if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) {
    await page.getByLabel("View options", { exact: true }).click();
    await page
      .getByRole("button", { name: "Arrange tasks", exact: true })
      .click();
  }
  const initialBox = await placeholders.first().boundingBox();
  const handle = page.getByRole("button", {
    name: /^Reorder Prepare quarterly planning session\./,
  });
  await handle.hover();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  try {
    await page.mouse.down();
    await expect(placeholders.first()).toHaveText("Drop here");
    expect(await placeholders.first().boundingBox()).toEqual(initialBox);
    await handle.dispatchEvent("pointercancel", { pointerId: 1 });
    await expect(page.getByText("Drop here", { exact: true })).toHaveCount(0);
    await expect(placeholders.first()).toHaveText("No tasks");
  } finally {
    await handle.dispatchEvent("pointercancel", { pointerId: 1 });
    await page.mouse.up();
  }
});
