import { test, expect } from "@playwright/test";

test("appearance follows the system by default and remembers explicit overrides", async ({
  page,
}) => {
  const appearance = page.getByRole("combobox", { name: "Appearance" });
  const scheme = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(appearance).toHaveValue("system");
  await expect.poll(scheme).toBe("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(scheme).toBe("light");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    "#fbfcfe",
  );
  await appearance.selectOption("dark");
  await expect.poll(scheme).toBe("dark");
  await page.reload();
  await expect(appearance).toHaveValue("dark");
  await expect.poll(scheme).toBe("dark");
  await page.emulateMedia({ colorScheme: "dark" });
  await appearance.selectOption("light");
  await expect.poll(scheme).toBe("light");
  await page.reload();
  await expect(appearance).toHaveValue("light");
  await expect.poll(scheme).toBe("light");
  await appearance.selectOption("system");
  await expect.poll(scheme).toBe("dark");
  await page.reload();
  await expect(appearance).toHaveValue("system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(scheme).toBe("light");
});

test("appearance works when browser storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("Storage blocked");
    };
    Storage.prototype.setItem = () => {
      throw new Error("Storage blocked");
    };
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const appearance = page.getByRole("combobox", { name: "Appearance" });
  await expect(appearance).toHaveValue("system");
  await appearance.selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
