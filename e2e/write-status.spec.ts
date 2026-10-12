import path from "node:path";
import { expect, test } from "./local-test";
import type { Page } from "@playwright/test";

async function open(page: Page, phase: string) {
  await page.clock.install({ time: new Date("2026-10-11T08:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-11T09:00:00Z"));
  await page.goto(`/e2e/write-status.fixture.html?phase=${phase}`);
  await expect(page.getByLabel("Task title", { exact: true })).toHaveValue(
    "Sync layout review",
  );
}
function stats(page: Page) {
  return page.evaluate(() =>
    (
      window as unknown as {
        syncPresentationStats: () => { updates: number };
      }
    ).syncPresentationStats(),
  );
}

test("an acknowledgement under two seconds never displays or announces sync status", async ({
  page,
}) => {
  await open(page, "fast");
  const notice = page.getByTestId("collection-write-status");
  await page.clock.runFor(1_100);
  await expect(notice).toHaveAttribute("aria-hidden", "true");
  await page.clock.runFor(1_200);
  await expect(notice).toHaveAttribute("aria-hidden", "true");
  await expect(page.getByText("Syncing…", { exact: true })).toHaveCount(0);
  await expect(
    page.locator(".task-toolbar [role=status], .task-row [role=status]"),
  ).toHaveCount(0);
  expect(await stats(page)).toEqual({ updates: 0 });
});

test("rapid autosaves and acknowledgement do not move the editor or toolbar", async ({
  page,
}) => {
  await open(page, "edit");
  const title = page.getByLabel("Task title", { exact: true });
  const targets = [
    title,
    page.locator(".task-toolbar"),
    page.locator(".task-form"),
  ];
  const original = await Promise.all(
    targets.map((target) => target.boundingBox()),
  );
  for (let index = 0; index < 8; index++) {
    await title.fill(`Sync layout edit ${index}`);
    await page.clock.runFor(650);
    for (let n = 0; n < targets.length; n++) {
      const box = await targets[n]!.boundingBox();
      expect(box).not.toBeNull();
      for (const dimension of ["x", "y", "width", "height"] as const)
        expect(
          Math.abs(box![dimension] - original[n]![dimension]),
        ).toBeLessThan(1);
    }
  }
  const notice = page.getByTestId("collection-write-status");
  await expect(notice).toHaveText("Syncing…");
  await expect(notice).toHaveAttribute("aria-live", "off");
  await expect(
    page.locator(".task-toolbar [role=status], .task-row [role=status]"),
  ).toHaveCount(0);
  expect(await stats(page)).toEqual({ updates: 8 });
  await page.clock.runFor(1_500);
  await expect(notice).toHaveAttribute("aria-hidden", "true");
  for (let n = 0; n < targets.length; n++)
    expect(await targets[n]!.boundingBox()).toEqual(original[n]);
});

test("sustained disconnection escalates politely", async ({ page }) => {
  await open(page, "offline");
  await page.clock.runFor(4_999);
  await expect(page.getByTestId("collection-write-status")).toHaveText(
    "Syncing…",
  );
  await page.clock.runFor(1);
  await expect(page.getByTestId("collection-write-status")).toHaveAttribute(
    "aria-live",
    "polite",
  );
  await expect(page.getByTestId("collection-write-status")).toContainText(
    "Saved on this device; waiting for sync",
  );
  expect((await stats(page)).updates).toBe(0);
});

for (const [phase, text] of [
  ["failed", "Change rejected"],
  ["conflicted", "Conflicting changes"],
  ["unknown", "Save outcome unknown"],
]) {
  test(`${phase} remains a polite problem with a review action`, async ({
    page,
  }) => {
    await open(page, phase!);
    const notice = page.getByTestId("collection-write-status");
    await expect(notice).toHaveAttribute("aria-live", "polite");
    await expect(notice).toContainText(text!);
    await expect(
      page.getByRole("button", { name: "Review record" }),
    ).toBeVisible();
    expect((await stats(page)).updates).toBe(0);
  });
}

test("capture sustained pending presentation", async ({ page }, testInfo) => {
  await open(page, "pending");
  await page.clock.runFor(2_100);
  if (process.env.UIPOLISH_BASELINE === "1")
    await expect(
      page
        .getByText("Saved locally · Waiting to sync", { exact: true })
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
  else
    await expect(page.getByTestId("collection-write-status")).toHaveText(
      "Syncing…",
    );
  if (process.env.UIPOLISH_SCREENSHOTS)
    await page.screenshot({
      path: path.join(
        process.env.UIPOLISH_SCREENSHOTS,
        `${testInfo.project.name}-${process.env.UIPOLISH_BASELINE === "1" ? "before" : "after"}.png`,
      ),
      animations: "disabled",
    });
});
