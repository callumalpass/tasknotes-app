import { expect, test } from "@playwright/test";

test("follows the system theme and persists explicit overrides", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("./");
  await page.evaluate(async () => {
    localStorage.clear();
    indexedDB.deleteDatabase("tasknotes-index-v2");
    const root = await navigator.storage.getDirectory();
    await root
      .removeEntry("TaskNotes", { recursive: true })
      .catch(() => undefined);
  });
  await page.reload();
  await page.getByRole("button", { name: /On this device/ }).click();

  const root = page.locator("html");
  await expect(root).not.toHaveAttribute("data-theme");
  await expect
    .poll(() =>
      root.evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--color-canvas").trim(),
      ),
    )
    .toBe("oklch(17.5% 0.012 255)");

  await page.getByRole("button", { name: "More" }).click();
  const select = page.getByRole("combobox", { name: "Color theme" });
  await select.selectOption("light");
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect
    .poll(() =>
      root.evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--color-canvas").trim(),
      ),
    )
    .toBe("oklch(99.2% 0.004 255)");

  await select.selectOption("dark");
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect
    .poll(() =>
      root.evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--color-canvas").trim(),
      ),
    )
    .toBe("oklch(17.5% 0.012 255)");
});
