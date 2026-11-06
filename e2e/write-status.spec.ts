import { expect, test } from "./local-test";
import type { Page } from "@playwright/test";

async function open(page: Page, phase: string) {
  await page.clock.install({ time: new Date("2026-10-11T08:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-11T09:00:00Z"));
  await page.goto(`e2e/write-status.fixture.html?phase=${phase}`);
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

test("rapid autosaves acknowledge all edits without noisy sync announcements", async ({
  page,
}) => {
  await open(page, "edit");
  await page.clock.resume();
  await expect(page.locator(".markdown-preview")).toHaveText(
    "A short note for checking the editor layout.",
  );
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
  const title = page.getByLabel("Task title", { exact: true });
  for (let index = 0; index < 8; index++) {
    await title.fill(`Sync layout edit ${index}`);
    await page.clock.runFor(650);
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
