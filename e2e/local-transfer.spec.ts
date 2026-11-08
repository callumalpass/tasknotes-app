import { test, expect } from "./local-test";

test("backdrop clicks retain reviewed choices and Escape restores the trigger", async ({
  page,
}) => {
  await page.goto("/e2e/local-transfer.fixture.html");
  const trigger = page.getByRole("button", {
    name: "Review local tasks",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Task type", exact: true })
    .selectOption("work");
  await page.mouse.click(4, 4);
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "Task type", exact: true }),
  ).toHaveValue("work");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("copying retains keyboard focus and Done returns it to the review trigger", async ({
  page,
}) => {
  let finish!: () => void;
  const confirmation = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let writes = 0;
  await page.route("**/e2e/local-transfer-write", async (route) => {
    writes++;
    await confirmation;
    await route.fulfill({ status: 204 });
  });
  await page.goto("/e2e/local-transfer.fixture.html");
  const trigger = page.getByRole("button", {
    name: "Review local tasks",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Task type", exact: true })
    .selectOption("work");
  await dialog
    .getByRole("button", { name: "Transfer work", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("status")).toHaveText("Copied 0 of 1");
  const copying = dialog.getByRole("button", {
    name: "Preparing transfer",
    exact: true,
  });
  await expect(copying).toBeFocused();
  await expect(copying).toBeDisabled();
  await page.keyboard.press("Enter");
  expect(writes).toBe(1);
  finish();
  const done = dialog.getByRole("button", { name: "Done", exact: true });
  await expect(done).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(done).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
