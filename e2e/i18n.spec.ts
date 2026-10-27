import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./local-test";

async function startupLocale(page: Page, locale: string): Promise<void> {
  await page.addInitScript(
    (value) => localStorage.setItem("tasknotes:locale", value),
    locale,
  );
}

for (const locale of ["en", "fr"]) {
  test(`collection settings ${locale}: local demo, controls and accessibility`, async ({
    page,
  }) => {
    await startupLocale(page, locale);
    await page.goto("more?demo=12");
    await expect(
      page.getByRole("heading", {
        name: locale === "fr" ? "Paramètres" : "Settings",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await page.goto("more/device?demo=12");
    await expect(
      page.getByRole("combobox", {
        name: locale === "fr" ? "Début de la semaine" : "Week starts",
        exact: true,
      }),
    ).toContainText(locale === "fr" ? "dim." : "Sun");
    await page.goto("more/collection?demo=12");
    const panel = page
      .getByRole("region", { name: "Collection", exact: true })
      .and(page.locator("#settings-collection"));
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
      .include("#settings-collection")
      .analyze();
    expect(results.violations).toEqual([]);
    await page.screenshot({
      path: `test-results/i18n-collection-${locale}-${test.info().project.name}.png`,
      fullPage: true,
    });
  });
}

test("French interface preserves user edits and stored English view names", async ({
  page,
}) => {
  await startupLocale(page, "fr");
  await page.goto("?demo=12");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await page
    .getByRole("button", {
      name: "Prepare quarterly planning session",
      exact: true,
    })
    .click();
  const title = page.getByRole("textbox", {
    name: "Titre de la tâche",
    exact: true,
  });
  await expect(title).toHaveValue("Prepare quarterly planning session");
  await expect(
    page.getByRole("button", { name: "Terminer la tâche", exact: true }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include(".task-screen")
    .analyze();
  expect(results.violations).toEqual([]);
  await title.fill("Ma tâche — untouched user content");
  await expect(page.locator(".save-state")).toHaveText("Enregistré");
  await page
    .getByRole("button", { name: /^(Retour|Fermer les détails de la tâche)$/ })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Ma tâche — untouched user content",
      exact: true,
    }),
  ).toBeVisible();
  await openNavigationItem(page, "Rechercher");
  const search = page.getByRole("searchbox", { name: "Rechercher des tâches" });
  await search.fill("Ma tâche");
  await expect(
    page.getByRole("button", {
      name: "Ma tâche — untouched user content",
      exact: true,
    }),
  ).toBeVisible();
  await search.blur();
  await openNavigationItem(page, "Bloc-notes");
  await expect(
    page.getByRole("heading", { name: "Bloc-notes", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Nouvelle note", exact: true }),
  ).toBeVisible();
  await openNavigationItem(page, "Paramètres");
  // Route changes commit inside a view transition; wait for Settings before
  // the non-waiting check below.
  await expect(
    page.getByRole("heading", { name: "Paramètres", level: 1 }),
  ).toBeVisible();
  const collectionSection = page
    .getByRole("navigation", { name: "Sections des paramètres" })
    .getByRole("button", { name: /^Collection / });
  if (await collectionSection.isVisible()) await collectionSection.click();
  await expect(
    page.getByRole("button", { name: "Actualiser maintenant", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("tasknotes:locale")),
  ).toBe("fr");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await page.screenshot({
    path: `test-results/i18n-app-fr-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("French capture, accepted-write notice and task actions", async ({
  page,
}) => {
  await startupLocale(page, "fr");
  await page.goto("?demo=12");
  // Saved view names and enum-backed collection status labels remain data.
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Nouvelle tâche", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Nouvelle tâche",
    exact: true,
  });
  await expect(dialog).toContainText("Continuer à ajouter des tâches");
  await expect(dialog).toContainText("Call Sam tomorrow 9am #work");
  await dialog
    .getByRole("combobox", { name: "Titre de la nouvelle tâche" })
    .fill("Une tâche française #work");
  await dialog.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const notice = page.locator(".task-added-notice");
  await expect(notice).toContainText("Tâche ajoutée : Une tâche française");
  await notice.getByRole("button", { name: "Ouvrir", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Titre de la tâche" }),
  ).toHaveValue("Une tâche française");
  await page
    .getByRole("button", { name: "Autres actions de tâche", exact: true })
    .click();
  const actions = page.locator(".task-actions-menu");
  await expect(
    actions
      .getByRole("button", { name: "Supprimer", exact: true })
      .or(actions.getByRole("menuitem", { name: "Supprimer", exact: true })),
  ).toBeVisible();
  await actions.getByText("Dates", { exact: true }).click();
  await expect(actions).toContainText("Planifier pour aujourd’hui");
  await expect(actions).toContainText("Échéance demain");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("French view editor and Scratchpad writing controls", async ({ page }) => {
  await startupLocale(page, "fr");
  await page.goto("views?demo=12");
  await expect(
    page.getByRole("heading", { name: "Gérer les vues", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Créer une vue", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Nom de la vue", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Nom de la vue", exact: true })
    .fill("");
  await expect(
    page.getByRole("button", { name: "Enregistrer la vue", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: "Détails de la vue", exact: true }),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include(".view-editor").analyze())
      .violations,
  ).toEqual([]);
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await page
    .getByRole("button", { name: "Abandonner les modifications", exact: true })
    .click();
  await openNavigationItem(page, "Bloc-notes");
  await page
    .getByRole("button", { name: "Nouvelle note", exact: true })
    .click();
  const current = page.getByRole("region", {
    name: "Éditeur de bloc-notes actuel",
    exact: true,
  });
  await current.getByRole("button", { name: "Écrire", exact: true }).click();
  await current
    .getByRole("textbox", { name: "Markdown du Bloc-notes", exact: true })
    .fill("- [ ] Texte personnel **inchangé**\n");
  await expect(current.locator(".scratchpad-save-state")).toHaveText(
    "Enregistré",
  );
  await expect(
    current.getByRole("button", { name: "Gras", exact: true }),
  ).toBeVisible();
  await current.getByRole("button", { name: "Plan", exact: true }).click();
  await expect(
    current.getByRole("tree", { name: "Plan du Bloc-notes", exact: true }),
  ).toBeVisible();
  await expect(
    current.getByRole("button", {
      name: "Actions pour élément vide",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    current.getByRole("textbox", {
      name: "Brouillon de tâche: Texte personnel **inchangé**",
      exact: true,
    }),
  ).toHaveValue("Texte personnel **inchangé**");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: `test-results/i18n-fr-writing-${test.info().project.name}.png`,
    fullPage: true,
  });
});

for (const locale of [
  "en",
  "fr",
  "de",
  "es",
  "ja",
  "ko",
  "pt",
  "ru",
  "zh",
  "it",
]) {
  test(`Settings switches and persists ${locale} without changing collection data`, async ({
    page,
  }) => {
    await startupLocale(page, locale);
    await page.goto("more/device?demo=12");
    const picker = page.locator(".language-picker");
    await expect(picker).toHaveValue(locale);
    await expect(picker.locator("option")).toHaveCount(10);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await page.setViewportSize({ width: 320, height: 900 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
    await expect(picker).toBeVisible();
    await page.screenshot({
      path: `test-results/i18n-settings-${locale}-${test.info().project.name}.png`,
      fullPage: true,
    });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });
    const next = locale === "en" ? "fr" : "en";
    await picker.selectOption(next);
    await expect(page.locator("html")).toHaveAttribute("lang", next);
    expect(
      await page.evaluate(() => localStorage.getItem("tasknotes:locale")),
    ).toBe(next);
    await openNavigationItem(page, "Today", next);
    await expect(
      page.getByRole("button", {
        name: "Prepare quarterly planning session",
        exact: true,
      }),
    ).toBeVisible();
    // A fresh browser tab (no startup script) verifies the saved explicit choice.
    const restored = await page.context().newPage();
    await restored.goto("more/device?demo=12");
    await expect(restored.locator("html")).toHaveAttribute("lang", next);
    await restored.close();
  });
}

test("Italian picker loads and persists authored copy and dates", async ({
  page,
}) => {
  await page.goto("more/device?demo=12");
  const picker = page.locator(".language-picker");
  await expect(picker.locator('option[value="it"]')).toHaveText("Italiano");
  await picker.selectOption("it");
  await expect(page.locator("html")).toHaveAttribute("lang", "it");
  await expect(
    page.getByRole("combobox", { name: "Lingua dell'app", exact: true }),
  ).toHaveValue("it");
  const restored = await page.context().newPage();
  await restored.goto("more/device?demo=12");
  await expect(restored.locator("html")).toHaveAttribute("lang", "it");
  await restored.close();
  await page.goto("e2e/private-account.fixture.html?count=2&summaries=1");
  await expect(page.getByTestId("daily-summary")).toHaveText("Ogni 2 giorni");
  await expect(page.getByTestId("month-end-8")).toHaveText(
    "Ogni mese, l'8° giorno dalla fine del mese",
  );
  await expect(page.getByTestId("date-today")).toHaveText("Oggi");
  await expect(page.getByTestId("date-tomorrow")).toHaveText("Domani");
  await expect(page.getByTestId("date-relative")).toHaveText("2 giorni fa");
  await expect(page.getByTestId("date-formatted")).toHaveText("mer 1 lug");
});

test("a failed locale chunk retains English, the explicit preference and a retryable Settings error", async ({
  page,
}) => {
  await startupLocale(page, "en");
  const blockCatalogues = (url: URL) =>
    url.pathname.includes("/locales/fr/messages.json") ||
    /\/assets\/messages-/.test(url.pathname);
  await page.route(blockCatalogues, (route) => route.abort());
  await page.goto("more/device?demo=12");
  const picker = page.locator(".language-picker");
  await expect(picker).toHaveValue("en");
  await picker.selectOption("fr");
  await expect(page.getByRole("alert")).toContainText(
    "The language could not be loaded",
  );
  await expect(picker).toHaveValue("en");
  expect(
    await page.evaluate(() => localStorage.getItem("tasknotes:locale")),
  ).toBe("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  // End the outage before testing a successful selection: the built application
  // and shared UI both now correctly emit messages-* chunks for every locale.
  await page.unroute(blockCatalogues);
  // A later successful selection must retire the old error, including on return
  // to the locale that was active when the original failure happened.
  await picker.selectOption("de");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await picker.selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

async function openNavigationItem(
  page: Page,
  name: string,
  locale = "fr",
): Promise<void> {
  const direct = page.getByRole("button", { name, exact: true });
  if (await direct.isVisible()) {
    await direct.click();
    return;
  }
  await page
    .getByRole("button", {
      name: locale === "fr" ? "Plus" : "More",
      exact: true,
    })
    .click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
