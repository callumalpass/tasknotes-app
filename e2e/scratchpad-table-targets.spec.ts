import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./local-test";
import { outlineOf } from "./scratchpad-editor";

for (const [width, height, hasTouch] of [
  [1042, 662, false],
  [1280, 800, false],
  [390, 844, false],
  [390, 844, true],
] as const) {
  test.describe(`${width}×${height} ${hasTouch ? "coarse" : "fine"}`, () => {
    test.use({ viewport: { width, height }, hasTouch });
    test("Scratchpad checkbox clears inactive and active table controls", async ({
      page,
    }) => {
      await page.goto("scratchpad/?demo=60");
      const current = page.locator(".scratchpad-current-document");
      const editor = outlineOf(current);
      const checkbox = current.getByRole("checkbox").first();
      await expect(checkbox).toBeVisible();
      const controls = current.locator(".cm-lp-table-controls > button");
      await expect(controls).toHaveCount(4);
      expect(
        await controls.evaluateAll((buttons) =>
          buttons.map((button) => button.getAttribute("title")),
        ),
      ).toEqual(["Column options", "Row options", "Add row", "Add column"]);
      const measure = () =>
        checkbox.evaluate((box) => {
          const rect = box.getBoundingClientRect();
          const overlaps = Array.from(
            box
              .closest(".cm-editor")!
              .querySelectorAll(".cm-lp-table-controls > button"),
          )
            .filter((el) => {
              const other = el.getBoundingClientRect();
              return (
                Math.min(rect.right, other.right) >
                  Math.max(rect.left, other.left) &&
                Math.min(rect.bottom, other.bottom) >
                  Math.max(rect.top, other.top)
              );
            })
            .map((el) => el.getAttribute("title"));
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            overlaps,
          };
        });
      const inactive = await measure();
      await test.info().attach("inactive geometry", {
        body: JSON.stringify(inactive),
        contentType: "application/json",
      });
      expect
        .soft(inactive, JSON.stringify(inactive))
        .toMatchObject({ width: 44, height: 44, overlaps: [] });
      await editor.fill(
        "- [ ] Draft\n\n| Item | Value |\n| --- | --- |\n| One | Two |\n\n",
      );
      await editor.getByText("One", { exact: true }).click();
      await expect(
        current.locator(".cm-lp-table-controls-visible"),
      ).toHaveCount(1);
      for (const button of await controls.all()) {
        await expect(button).toBeVisible();
      }
      const active = await measure();
      await test.info().attach("active geometry", {
        body: JSON.stringify(active),
        contentType: "application/json",
      });
      expect(active).toMatchObject({ width: 44, height: 44, overlaps: [] });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(0);
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.evaluate(async () => {
          document.documentElement.getBoundingClientRect();
          await Promise.allSettled(
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.effect?.getTiming().iterations !== Infinity,
              )
              .map((animation) => animation.finished),
          );
        });
        expect(
          (
            await new AxeBuilder({ page })
              .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
              .analyze()
          ).violations,
        ).toEqual([]);
      }
    });
  });
}
