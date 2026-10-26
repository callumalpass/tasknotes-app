import { expect, test } from "./local-test";

// Deliberately outside *.spec.ts: checks an already built NORMAL production artifact.
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
  test(`production activates saved ${locale} from its own deployment`, async ({
    page,
  }) => {
    const catalogues: string[] = [];
    page.on("request", (request) => {
      if (/\/assets\/messages-/.test(new URL(request.url()).pathname))
        catalogues.push(request.url());
    });
    await page.addInitScript(
      (value) => localStorage.setItem("tasknotes:locale", value),
      locale,
    );
    // The retired preview query must not override the persisted selection.
    await page.goto("?i18n-pilot=fr");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator("#root")).not.toBeEmpty();
    if (locale === "en") expect(catalogues).toHaveLength(0);
    else expect(catalogues.length).toBeGreaterThan(0);
    for (const url of catalogues)
      expect(new URL(url).origin).toBe(new URL(page.url()).origin);
  });
}

test.describe("Italian browser negotiation", () => {
  test.use({ locale: "it-IT" });
  test("uses Italian without persisting an implicit browser preference", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "it");
    expect(
      await page.evaluate(() => localStorage.getItem("tasknotes:locale")),
    ).toBeNull();
  });
});

test.describe("browser negotiation", () => {
  test.use({ locale: "pt-BR" });
  test("uses Brazilian Portuguese when no explicit choice exists", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt");
    expect(
      await page.evaluate(() => localStorage.getItem("tasknotes:locale")),
    ).toBeNull();
  });

  test("ignores unsupported saved values and honors browser language", async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem("tasknotes:locale", "unsupported"),
    );
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt");
  });

  test("an explicit English choice beats the browser language", async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem("tasknotes:locale", "en"),
    );
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});
