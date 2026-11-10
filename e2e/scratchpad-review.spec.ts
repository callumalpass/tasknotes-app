import { expect, test } from "./local-test";
import { openFixture } from "./next-fixture";
import { outlineOf } from "./scratchpad-editor";

test("Scratchpad updates a linked title after saving a rename through detail", async ({
  page,
}) => {
  await openFixture(page, { records: [] }, "scratchpad/");
  const note = outlineOf(page.locator(".scratchpad-current-document"));
  await expect(note).toBeFocused();
  await page.keyboard.type("Linked original");
  await page.getByRole("button", { name: "Create tasks", exact: true }).click();
  // A line that links a task shows it by its title, wherever that changes.
  const link = (title: string) =>
    page
      .locator(".scratchpad-current-document")
      .getByRole("button", { name: title, exact: true });
  await link("Linked original").click();
  const detail = page.getByRole("complementary", { name: "Task details" });
  await detail
    .getByRole("textbox", { name: "Task title", exact: true })
    .fill("Linked renamed");
  await detail.getByRole("textbox", { name: "Task title", exact: true }).blur();
  await expect(detail.getByText("Saved", { exact: true })).toBeVisible();
  await detail
    .getByRole("button", { name: "Close task details", exact: true })
    .click();
  await expect(link("Linked renamed")).toBeVisible();
  await expect(link("Linked original")).toHaveCount(0);
});

test("Scratchpad review owns focus and isolates the background", async ({
  page,
}) => {
  await openFixture(page, { records: [] }, "scratchpad/");
  const draft = outlineOf(page.locator(".scratchpad-current-document"));
  await expect(draft).toBeFocused();
  await page.keyboard.type("Review focus regression");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Another draft for review");
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
