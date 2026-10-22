import path from "node:path";
import { expect, test } from "./local-test";

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme });
    for (const [width, largeText] of [
      [1440, false],
      [390, false],
      [320, true],
    ] as const) {
      test(`Scratchpad image action is named visibly at ${width}px${largeText ? " / 200% text" : ""}`, async ({
        page,
      }, info) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/e2e/scratchpad-actions.fixture.html");
        if (largeText)
          await page.evaluate(() => {
            document.documentElement.style.fontSize = "200%";
          });
        const action = page.getByRole("button", {
          name: "Add image",
          exact: true,
        });
        const newNote = page.getByRole("button", {
          name: "New note",
          exact: true,
        });
        await expect(
          action.getByText("Add image", { exact: true }),
        ).toBeVisible();
        await expect(action).toBeEnabled();
        for (const button of [action, newNote]) {
          const bounds = (await button.boundingBox())!;
          expect(bounds.height).toBeGreaterThanOrEqual(44);
          expect(bounds.width).toBeGreaterThanOrEqual(44);
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        }
        const imageBox = (await action.boundingBox())!,
          noteBox = (await newNote.boundingBox())!;
        expect(
          imageBox.x + imageBox.width <= noteBox.x ||
            imageBox.y + imageBox.height <= noteBox.y,
        ).toBe(true);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
        await action.scrollIntoViewIfNeeded();
        await expect(action).toBeInViewport();
        const writing = page.locator(".scratchpad-current-document");
        await expect(writing).toBeVisible();
        const writingWidth = (await writing.boundingBox())!.width;
        if (
          process.env.UIPOLISH_SCREENSHOTS &&
          info.project.name === "desktop" &&
          colorScheme === "light"
        ) {
          const old = await page.addStyleTag({
            content:
              "body .scratchpad-image-action {width:38px;padding:0;min-height:38px} body .scratchpad-new-action {min-height:38px} body .scratchpad-image-action > span {display:none}",
          });
          await page.screenshot({
            path: path.join(
              process.env.UIPOLISH_SCREENSHOTS,
              `${width}-before.png`,
            ),
            animations: "disabled",
          });
          expect((await writing.boundingBox())!.width).toBe(writingWidth);
          await old.evaluate((element) => element.remove());
          await page.screenshot({
            path: path.join(
              process.env.UIPOLISH_SCREENSHOTS,
              `${width}-after.png`,
            ),
            animations: "disabled",
          });
        }
        await action.click();
        await expect(action).toHaveAttribute("aria-expanded", "true");
        await expect(
          page.getByRole("region", { name: "Add image" }),
        ).toBeVisible();
        expect((await writing.boundingBox())!.width).toBe(writingWidth);
        await action.click();
        await expect(action).toHaveAttribute("aria-expanded", "false");
        await expect(
          page.getByRole("region", { name: "Add image" }),
        ).toHaveCount(0);
      });
    }
  });
}
