import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

async function resetApplication(page: Page): Promise<void> {
  // Reset from a same-origin document that does not initialize the Vault.
  // Removing the OPFS directory while TaskNotes is opening can correctly put
  // the live app into its restart-required recovery state.
  await page.goto("./tasknotes-mark.svg");
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
  });
  await page.goto("./");
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
    page.getByRole("heading", { name: "Sync with mdbase." }),
  ).toBeVisible();
  await expectNoSeriousViolations(page);
});

test("views and settings have no serious accessibility violations", async ({
  page,
}) => {
  await resetApplication(page);
  await page.evaluate(() =>
    localStorage.setItem("tasknotes:collection-choice:v1", "local"),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Today", level: 1 }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Views", exact: true }).click();
  await page.getByRole("menuitem", { name: "Manage views" }).click();
  await expect(page.getByRole("heading", { name: "Views" })).toBeVisible();
  await expectNoSeriousViolations(page);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
  await expect(page.getByText("Saved views", { exact: true })).toHaveCount(0);
  await expectNoSeriousViolations(page);
});

test("scratchpad editor has no serious accessibility violations", async ({
  page,
}) => {
  await resetApplication(page);
  await page.evaluate(() =>
    localStorage.setItem("tasknotes:collection-choice:v1", "local"),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Today", level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Scratchpad", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Scratchpad", level: 1 }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Draft task: empty" })
    .fill("Accessible outline item tomorrow");
  await expectNoSeriousViolations(page);
});

test("task list and editor have no serious accessibility violations", async ({
  page,
}) => {
  await resetApplication(page);
  await page.evaluate(() =>
    localStorage.setItem("tasknotes:collection-choice:v1", "local"),
  );
  await page.reload();
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
