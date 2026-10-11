import path from "node:path";
import { expect, test } from "./local-test";

for (const width of [1440, 390, 320]) {
  test(`sign-in label uses the available button width at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("e2e/welcome-layout.fixture.html");
    if (width === 320)
      await page.addStyleTag({ content: ":root {font-size:200% !important}" });
    const button = page.getByRole("button", { name: "Sign in", exact: true });
    await expect(button).toBeVisible();
    const label = button.locator("span");
    expect(
      await label.evaluate(
        (element) =>
          element.getBoundingClientRect().height /
          Number.parseFloat(getComputedStyle(element).lineHeight),
      ),
    ).toBeLessThanOrEqual(1.1);
    const bounds = (await button.boundingBox())!;
    const text = (await label.boundingBox())!;
    const arrow = (await button.locator("svg").boundingBox())!;
    expect(text.width).toBeGreaterThan(bounds.width / 2);
    expect(arrow.x).toBeGreaterThan(text.x + text.width - 1);
    expect(arrow.x + arrow.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    await button.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("sign-in.png") });
    if (process.env.UIPOLISH_SCREENSHOTS) {
      await page.screenshot({
        path: path.join(
          process.env.UIPOLISH_SCREENSHOTS,
          `${testInfo.project.name}-${width}-after.png`,
        ),
      });
      // Restore the pre-fix grid only for a controlled presentation comparison.
      await page.addStyleTag({
        content:
          ".welcome-primary-action {grid-template-columns:24px minmax(0,1fr) 18px !important;gap:normal !important}",
      });
      expect(
        await label.evaluate(
          (element) =>
            element.getBoundingClientRect().height /
            Number.parseFloat(getComputedStyle(element).lineHeight),
        ),
      ).toBeGreaterThan(1.1);
      await button.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(
          process.env.UIPOLISH_SCREENSHOTS,
          `${testInfo.project.name}-${width}-before.png`,
        ),
      });
    }
  });
}

test("opening label still spans the whole button", async ({ page }) => {
  await page.goto("e2e/welcome-layout.fixture.html?opening");
  const button = page.getByRole("button", {
    name: "Opening mdbase…",
    exact: true,
  });
  await expect(button).toBeDisabled();
  await expect(button.locator("span")).toHaveCSS("grid-column-start", "1");
  await expect(button.locator("span")).toHaveCSS("grid-column-end", "-1");
});
