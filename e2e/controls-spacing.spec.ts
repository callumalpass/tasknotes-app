import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./local-test";

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme });

    test("settings and task fields share readable controls and clear grouping", async ({
      page,
    }) => {
      const fieldSize = page.viewportSize()!.width >= 840 ? "16px" : "17px";
      await page.goto("more?demo=50");
      const theme = page
        .locator(".theme-picker .tasknotes-control-trigger")
        .first();
      await expect(theme).toHaveCSS("font-size", fieldSize);
      await expect(theme).toHaveCSS("font-family", /Atkinson Hyperlegible/);
      await expect(theme).toHaveCSS("border-radius", "6px");
      await expect(theme).toHaveCSS("min-height", "44px");
      await theme.focus();
      await page.keyboard.press("ArrowDown");
      await expect(page.getByRole("listbox")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(theme).toBeFocused();
      await expect(theme).toHaveCSS("outline-width", "2px");
      await expect(theme).toHaveCSS("outline-style", "solid");
      await expect(page.locator(".settings-section").first()).toHaveCSS(
        "margin-top",
        "24px",
      );

      await page.goto("?demo=50");
      await page
        .getByRole("button", {
          name: "Prepare quarterly planning session",
          exact: true,
        })
        .click();
      await page.getByText("Schedule and status", { exact: true }).click();
      const fields = page.locator(".task-core-fields");
      const label = fields.locator(".form-field > span").first();
      await expect(label).toHaveCSS("font-family", /Atkinson Hyperlegible/);
      await expect(label).toHaveCSS("font-size", "14px");
      await expect(label).toHaveCSS("text-transform", "none");
      await expect(label).toHaveCSS("margin-bottom", "4px");
      for (const control of await fields
        .locator(".tasknotes-control-trigger")
        .all()) {
        await expect(control).toHaveCSS("font-size", fieldSize);
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(
          44,
        );
      }
      await expect(fields).toHaveCSS("gap", "16px");
      await expect(fields).toHaveCSS("padding-bottom", "0px");
      await expect(fields.locator("..")).toHaveCSS("padding-bottom", "24px");
      const scan = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        scan.violations.filter(
          (v) => v.impact === "serious" || v.impact === "critical",
        ),
      ).toEqual([]);
    });

    test("date property controls retain targets and keyboard focus", async ({
      page,
    }) => {
      await page.goto("?demo=50");
      const trigger = page
        .locator(".task-row")
        .first()
        .getByRole("button", { name: /^Scheduled:/ });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Edit Scheduled" });
      await expect(dialog).toBeVisible();
      for (const control of await dialog.getByRole("button").all()) {
        await expect
          .poll(async () => (await control.boundingBox())?.height ?? 0)
          .toBeGreaterThanOrEqual(44);
      }
      await page.keyboard.press("Tab");
      const clear = dialog.getByRole("button", { name: "Clear value" });
      await clear.focus();
      await expect(clear).toHaveCSS("outline-style", "solid");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });

    test("view fields stay subordinate to the name and property Save uses the shared action", async ({
      page,
    }) => {
      await page.goto("views?demo=50");
      await page
        .getByRole("button", { name: "More actions for Today", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
      const name = page.getByRole("textbox", { name: "View name" });
      expect(
        await name.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      ).toBeGreaterThan(20);
      await page.getByRole("button", { name: /Fields shown/ }).click();
      const property = page.getByRole("combobox", {
        name: "Property to display",
      });
      await property.fill("recurrence");
      await page.keyboard.press("Escape");
      await property
        .locator("..")
        .locator("..")
        .getByRole("button", { name: "Add", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Save view", exact: true })
        .click();
      await page.getByRole("button", { name: "Today", exact: true }).click();
      await page.getByRole("button", { name: /^Recurrence:/ }).click();
      const dialog = page.getByRole("dialog", { name: "Edit Recurrence" });
      const save = dialog.getByRole("button", { name: "Save", exact: true });
      await expect(save).toHaveCSS("min-height", "44px");
      await expect(save).toHaveCSS("border-radius", "6px");
      await expect(save).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(save).toBeEnabled();
      await save.click();
      await expect(dialog).toHaveCount(0);
    });

    test("expanded task fields reflow at 320px and 200% text", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 844 });
      await page.goto("?demo=50");
      await page
        .getByRole("button", {
          name: "Prepare quarterly planning session",
          exact: true,
        })
        .click();
      await page.getByText("Schedule and status", { exact: true }).click();
      await page.getByText("Organize", { exact: true }).click();
      await page.addStyleTag({
        content: ":root { font-size: 200% !important; }",
      });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(320);
      const controls = page.locator(
        ".task-core-fields .tasknotes-control-trigger, .metadata-fields input",
      );
      for (const control of await controls.all()) {
        const bounds = await control.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
        expect(bounds!.height).toBeGreaterThanOrEqual(44);
      }
    });
  });
}
