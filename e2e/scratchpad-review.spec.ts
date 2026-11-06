import { expect, test } from "./local-test";
import { openFixture } from "./next-fixture";

test("Scratchpad updates a linked title after saving a rename through detail", async ({
  page,
}) => {
  await openFixture(page, { records: [] }, "scratchpad/");
  await page
    .getByRole("textbox", { name: "Draft task: empty", exact: true })
    .fill("Linked original");
  await page.getByRole("button", { name: "Create tasks", exact: true }).click();
  const link = page.locator(".scratchpad-task-link");
  await expect(link).toHaveAccessibleName("Linked original");
  await link.click();
  const detail = page.getByRole("complementary", { name: "Task details" });
  await detail
    .getByRole("textbox", { name: "Task title", exact: true })
    .fill("Linked renamed");
  await detail.getByRole("textbox", { name: "Task title", exact: true }).blur();
  await expect(detail.getByText("Saved", { exact: true })).toBeVisible();
  await detail
    .getByRole("button", { name: "Close task details", exact: true })
    .click();
  await expect(link).toHaveAccessibleName("Linked renamed");
  await expect(link).toContainText("Linked renamed");
});

test("Scratchpad review owns focus and isolates the background", async ({
  page,
}) => {
  await openFixture(page, { records: [] }, "scratchpad/");
  const input = page.getByRole("textbox", {
    name: "Draft task: empty",
    exact: true,
  });
  await input.fill("Review focus regression");
  await page
    .getByRole("textbox", {
      name: "Draft task: Review focus regression",
      exact: true,
    })
    .press("Enter");
  await page
    .getByRole("textbox", { name: "Draft task: empty", exact: true })
    .fill("Another draft for review");
  const draft = page.getByRole("textbox", {
    name: "Draft task: Review focus regression",
    exact: true,
    includeHidden: true,
  });
  const trigger = page.getByRole("button", {
    name: "Create tasks",
    exact: true,
  });
  await trigger.focus();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Create tasks" });
  const close = dialog.getByRole("button", { name: "Close", exact: true });
  await expect(close).toBeFocused();
  expect(
    await draft.evaluate((element) => {
      for (
        let parent: HTMLElement | null = element as HTMLElement;
        parent;
        parent = parent.parentElement
      )
        if (parent.inert) return true;
      return false;
    }),
  ).toBe(true);
  const create = dialog.getByRole("button", {
    name: /^Create \d+ tasks?$/,
  });
  await create.focus();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(create).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await draft.focus();
  await expect(draft).toBeFocused();
});
