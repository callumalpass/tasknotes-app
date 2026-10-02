import { expect, test } from "./local-test";

test("Scratchpad review owns focus and isolates the background", async ({
  page,
}) => {
  await page.goto("scratchpad/?demo=1");
  const input = page.getByRole("textbox", {
    name: "Draft task: empty",
    exact: true,
  });
  await input.fill("Review focus regression");
  const draft = page.getByRole("textbox", {
    name: "Draft task: Review focus regression",
    exact: true,
    includeHidden: true,
  });
  const trigger = page.getByRole("button", {
    name: "Create task notes",
    exact: true,
  });
  await trigger.focus();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Create task notes" });
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
    name: /^Create \d+ task notes$/,
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
