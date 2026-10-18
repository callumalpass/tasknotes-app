import { expect, test } from "./local-test";

test("migration waits with friendly copy and retry, then resumes the shared gate", async ({
  page,
}) => {
  await page.goto("e2e/account-upgrade.fixture.html");
  await expect(
    page.getByRole("heading", { name: "Your collection is being upgraded" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Your data is safe. This usually takes a few minutes/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Check now" })).toBeEnabled();
  await expect(
    page.getByText("collection_migrating", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Check now" }).click();
  await expect(page.getByRole("button", { name: "Check now" })).toBeEnabled();
  await page.getByRole("button", { name: "Complete upgrade fixture" }).click();
  await expect(
    page.getByRole("heading", { name: "Your collection is being upgraded" }),
  ).toHaveCount(0);
  await expect(page.getByText("Notes", { exact: true })).toBeVisible();
});
