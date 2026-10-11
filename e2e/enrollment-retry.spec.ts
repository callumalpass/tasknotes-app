import { test, expect } from "./local-test";

test("approved-target failure offers one explicit keyboard recovery action", async ({
  page,
}) => {
  await page.goto("/e2e/enrollment-retry.fixture.html");
  await page.getByRole("button", { name: "Simulate account approval" }).click();
  const retry = page.getByRole("button", { name: "Retry", exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("could not be confirmed");
  const count = page.getByRole("status", {
    name: "Original-target selection count",
  });
  await expect(count).toHaveText("0");
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(retry).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect(count).toHaveText("1");
  await expect(
    page.getByRole("status", { name: "Last selected target" }),
  ).toHaveText("11111111-1111-4111-8111-111111111111");
  await expect(
    page.getByText("Complete your selection in the mdbase window."),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Settle original-target check" })
    .click();
  await expect(retry).toHaveCount(0);
  await expect(count).toHaveText("1");
});
