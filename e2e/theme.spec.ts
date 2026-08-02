import { expect, test } from "@playwright/test";

test("follows the system theme and persists explicit overrides", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("./");
  await page.evaluate(async () => {
    localStorage.clear();
    await Promise.all(
      ["tasknotes-index-v2", "tasknotes-commands-v2"].map(
        (name) =>
          new Promise<void>((resolve, reject) => {
            const request = indexedDB.deleteDatabase(name);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
            request.onblocked = () =>
              reject(new Error(`Database reset was blocked: ${name}`));
          }),
      ),
    );
    const root = await navigator.storage.getDirectory();
    await root
      .removeEntry("TaskNotes", { recursive: true })
      .catch(() => undefined);
    localStorage.setItem("tasknotes:collection-choice:v1", "local");
  });
  await page.reload();

  const root = page.locator("html");
  const readCanvas = () =>
    root.evaluate((element) =>
      getComputedStyle(element).getPropertyValue("--color-canvas").trim(),
    );
  await expect(root).not.toHaveAttribute("data-theme");
  await expect.poll(readCanvas).not.toBe("");
  const systemDarkCanvas = await readCanvas();

  await page.getByRole("button", { name: "More", exact: true }).click();
  const select = page.getByRole("combobox", { name: "Color theme" });
  await select.click();
  await page.getByRole("option", { name: "Light", exact: true }).click();
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect.poll(readCanvas).not.toBe(systemDarkCanvas);

  await select.click();
  await page.getByRole("option", { name: "Dark", exact: true }).click();
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect.poll(readCanvas).toBe(systemDarkCanvas);
});
