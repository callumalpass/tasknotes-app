import { expect, test } from "./local-test";

// Deliberately outside default *.spec.ts discovery. Run with playwright.production-i18n.config.ts.
test("normal production artifact ignores the French preview query", async ({
  page,
}) => {
  await page.goto("more?demo=12&i18n-pilot=fr");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("button", { name: "Refresh now", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Actualiser maintenant", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "How tasks are stored", exact: true }),
  ).toBeVisible();
});
