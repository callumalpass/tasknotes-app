import { test, expect } from "./local-test";

test("opens /import in the app shell and never invents a demo destination", async ({
  page,
}) => {
  await page.goto("/import?demo=60");
  await page.locator(".app-shell").waitFor();
  await expect(
    page.getByRole("heading", { name: "Import from Todoist" }),
  ).toBeVisible();
  await expect(
    page.getByText("Choose a connected collection before importing."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect Todoist", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Preview import" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("import-desktop.png"),
    fullPage: true,
  });
});

test("Settings opens the integrated import route without opening a second app", async ({
  page,
}) => {
  await page.goto("/more/collection?demo=60");
  await page.locator(".app-shell").waitFor();
  await page
    .getByRole("button", { name: "Import from Todoist", exact: true })
    .click();
  await expect(page).toHaveURL(/\/import\?demo=60$/);
  await expect(
    page.getByRole("heading", { name: "Import from Todoist" }),
  ).toBeVisible();
});

test("the integrated import surface stays usable on a narrow phone viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/import?demo=60");
  await page.locator(".app-shell").waitFor();
  await expect(
    page.getByRole("heading", { name: "Import from Todoist" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect Todoist", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("import-phone.png"),
    fullPage: true,
  });
});
