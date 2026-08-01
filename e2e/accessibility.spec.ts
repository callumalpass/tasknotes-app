import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

async function resetApplication(page: Page): Promise<void> {
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
}

async function expectNoSeriousViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
}

test("collection onboarding has no serious accessibility violations", async ({
  page,
}) => {
  await resetApplication(page);
  await expect(
    page.getByRole("heading", {
      name: "Choose how TaskNotes stores your tasks.",
    }),
  ).toBeVisible();
  await expectNoSeriousViolations(page);
});

test("task list and editor have no serious accessibility violations", async ({
  page,
}) => {
  await resetApplication(page);
  await page.getByRole("button", { name: /On this device/ }).click();
  await page.getByRole("button", { name: "Use this browser" }).click();
  await expect(
    page.getByRole("heading", { name: "Today", level: 1 }),
  ).toBeVisible();
  await expectNoSeriousViolations(page);

  await page.getByLabel("New task title").fill("Accessible task");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("Accessible task", { exact: true }).click();
  await expect(page.getByLabel("Task title", { exact: true })).toBeVisible();
  await expectNoSeriousViolations(page);
});
