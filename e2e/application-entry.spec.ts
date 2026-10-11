import { expect, test } from "./local-test";

test("public entry original-target Retry requires a click and suppresses duplicates", async ({
  page,
}) => {
  await page.goto("/e2e/application-entry.fixture.html");
  const retry = page.getByRole("button", { name: /^Retry$/ });
  await expect(retry).toBeVisible();
  await expect(page.getByTestId("selection-count")).toHaveText("0");
  await expect(page.getByRole("alert")).toContainText(
    "retry to check the original request",
  );
  await retry.click();
  await expect(page.getByTestId("selection-count")).toHaveText("1");
  await expect(page.getByTestId("selection-target")).toHaveText(
    "11111111-1111-4111-8111-111111111111",
  );
  await expect(
    page.getByRole("button", { name: "Open Original tasks" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Finish original selection" }).click();
  await expect(
    page.getByRole("button", { name: "Choose another collection in mdbase" }),
  ).toBeEnabled();
  await expect(page.getByTestId("selection-count")).toHaveText("1");
});
