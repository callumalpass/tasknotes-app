import { test, expect } from "./local-test";

const fixture = "/e2e/collection-picker.fixture.html";
test("pre-selection Cancel and Escape preserve workspace/URL and restore focus", async ({
  page,
}) => {
  await page.goto(fixture);
  const url = page.url(),
    trigger = page.getByRole("button", { name: "Change collection" });
  for (const method of ["button", "Escape"]) {
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Choose where to work" });
    await expect(
      dialog.getByRole("button", { name: "Personal Hosted by mdbase Current" }),
    ).toBeFocused();
    const last = dialog.getByRole("button", {
      name: /Connect another collection/,
    });
    await last.focus();
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", { name: "Close collection picker" }),
    ).toBeFocused();
    if (method === "button")
      await dialog
        .getByRole("button", { name: "Close collection picker" })
        .click();
    else await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(page.url()).toBe(url);
    await expect(
      page.getByRole("heading", { name: "Workspace: Personal" }),
    ).toBeVisible();
    await expect(page.getByTestId("caller-actions")).toHaveText("[]");
  }
});

test("large-text narrow dark layout keeps long names and all controls within the modal", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto(fixture);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
    document.documentElement.dataset.theme = "dark";
  });
  await page.getByRole("button", { name: "Change collection" }).click();
  const dialog = page.getByRole("dialog");
  const geometry = await dialog.evaluate((element) => ({
    width: element.clientWidth,
    scroll: element.scrollWidth,
    left: element.getBoundingClientRect().left,
    right: element.getBoundingClientRect().right,
  }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(320);
  for (const button of await dialog.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  const long = dialog.getByRole("button", {
    name: "UnbrokenCollectionNameForNarrowScreensAndLargeText Open",
  });
  await long.scrollIntoViewIfNeeded();
  await expect(long).toBeVisible();
  await dialog.getByRole("searchbox").fill("travel");
  await expect(
    dialog.getByRole("button", { name: "Travel Open" }),
  ).toBeVisible();
});

test("explicit callback selection disables duplicate actions without claiming a native collection", async ({
  page,
}) => {
  await page.goto(fixture);
  await page.getByRole("button", { name: "Change collection" }).click();
  await page
    .getByRole("button", { name: "Work Connected computer Open" })
    .click();
  await expect(page.getByRole("status")).toHaveText("Opening Work…");
  await expect(
    page.getByRole("button", { name: "Close collection picker" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("caller-actions")).toHaveText(
    '["select:beta"]',
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Workspace: Work" }),
  ).toBeVisible();
});

test("empty/error state requires an explicit retry and keeps dismissal reachable", async ({
  page,
}) => {
  await page.goto(`${fixture}?empty&error`);
  await page.getByRole("button", { name: "Change collection" }).click();
  await expect(
    page.getByRole("button", { name: "Close collection picker" }),
  ).toBeFocused();
  await expect(page.getByRole("alert")).toHaveText(
    "This collection needs approval.",
  );
  await expect(page.getByTestId("caller-actions")).toHaveText("[]");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("caller-actions")).toHaveText('["retry"]');
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
