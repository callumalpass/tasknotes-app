import { expect, test } from "./local-test";

test("real public SDK constructor is lazy and retains the singleton in a browser", async ({
  page,
}) => {
  await page.goto("e2e/public-entry.fixture.html");
  await expect(page.getByTestId("entry-status")).toHaveText("not_started");
  await expect(page.getByTestId("selection-state")).toHaveText("none");
  await expect(page.getByTestId("singleton")).toHaveText("true");
  await expect(page.getByTestId("connection")).toHaveText("true");
});
