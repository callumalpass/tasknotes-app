import { expect, test } from "./local-test";

test("migration waits with friendly copy and retry, then resumes the shared gate", async ({
  page,
}) => {
  await page.goto("/e2e/account-upgrade.fixture.html");
  await expect(
    page.getByRole("heading", { name: "Your account is being upgraded" }),
  ).toBeVisible();
  await expect(
    page.getByText(/this usually completes within a day. Your tasks are safe/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeEnabled();
  await expect(
    page.getByText("collection_migrating", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("button", { name: "Retry" })).toBeEnabled();
  await page.getByRole("button", { name: "Complete upgrade fixture" }).click();
  await expect(
    page.getByRole("heading", { name: "Your account is being upgraded" }),
  ).toHaveCount(0);
  await expect(page.getByText("Notes", { exact: true })).toBeVisible();
});
