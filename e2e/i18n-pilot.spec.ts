import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./local-test";

for (const locale of ["en", "fr"]) {
  test(`collection settings pilot ${locale}: local demo, controls and accessibility`, async ({
    page,
  }) => {
    await page.goto(`more?demo=12&i18n-pilot=${locale}`);
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    const panel = page.getByRole("region", { name: "Collection", exact: true });
    await expect(panel).toContainText("TaskNotes demo");
    await expect(panel).toContainText(locale === "fr" ? "au total" : "total");
    const refresh = panel.getByRole("button", {
      name: locale === "fr" ? "Actualiser maintenant" : "Refresh now",
      exact: true,
    });
    await expect(refresh).toBeVisible();
    await refresh.click();
    await expect(refresh).toBeEnabled();
    const disclosure = panel.getByRole("button", {
      name:
        locale === "fr"
          ? "Comment les tâches sont stockées"
          : "How tasks are stored",
    });
    await disclosure.click();
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toContainText(
      locale === "fr"
        ? "Les modifications nécessitent une connexion"
        : "Changes require a connection",
    );
    await expect(
      panel.getByRole("button", {
        name: locale === "fr" ? "Changer de collection" : "Change collection",
      }),
    ).toBeVisible();
    const results = await new AxeBuilder({ page })
      .include(".settings-section[aria-labelledby='collection-settings-title']")
      .analyze();
    expect(results.violations).toEqual([]);
    await page.screenshot({
      path: `test-results/i18n-pilot-${locale}-${test.info().project.name}.png`,
      fullPage: true,
    });
  });
}
