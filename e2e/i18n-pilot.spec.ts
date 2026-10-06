import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./local-test";

for (const locale of ["en", "fr"]) {
  test(`collection settings pilot ${locale}: local demo, controls and accessibility`, async ({
    page,
  }) => {
    await page.goto(`more?demo=12&i18n-pilot=${locale}`);
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
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

test("application-wide partial preview preserves English fallbacks and user edits", async ({
  page,
}) => {
  await page.goto("?demo=12&i18n-pilot=fr");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await page
    .getByRole("button", {
      name: "Prepare quarterly planning session",
      exact: true,
    })
    .click();
  const title = page.getByRole("textbox", { name: "Task title", exact: true });
  await expect(title).toHaveValue("Prepare quarterly planning session");
  await expect(
    page.getByRole("button", { name: "Complete task", exact: true }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include(".task-screen")
    .analyze();
  expect(results.violations).toEqual([]);
  await title.fill("Ma tâche — untouched user content");
  await expect(page.locator(".save-state")).toHaveText("Saved");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Ma tâche — untouched user content",
      exact: true,
    }),
  ).toBeVisible();
  await openNavigationItem(page, "Search");
  const search = page.getByRole("searchbox", { name: "Search tasks" });
  await search.fill("Ma tâche");
  await expect(
    page.getByRole("button", {
      name: "Ma tâche — untouched user content",
      exact: true,
    }),
  ).toBeVisible();
  await search.blur();
  await openNavigationItem(page, "Scratchpad");
  await expect(
    page.getByRole("heading", { name: "Scratchpad", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New note", exact: true }),
  ).toBeVisible();
  await openNavigationItem(page, "Settings");
  await expect(
    page.getByRole("button", { name: "Actualiser maintenant", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/i18n-pilot=fr/);
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await page.screenshot({
    path: `test-results/i18n-app-fr-${test.info().project.name}.png`,
    fullPage: true,
  });
});

async function openNavigationItem(page: Page, name: string): Promise<void> {
  const direct = page.getByRole("button", { name, exact: true });
  if (await direct.isVisible()) {
    await direct.click();
    return;
  }
  await page.getByRole("button", { name: "Browse", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
