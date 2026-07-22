import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
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
  await page.getByRole("button", { name: /On this device/ }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
});

test("edits planning fields, recurrence, reminders, and upcoming tasks", async ({
  page,
}) => {
  await page.getByLabel("New task title").fill("Prepare weekly review");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("Prepare weekly review", { exact: true }).click();

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowValue = [
    tomorrow.getFullYear(),
    String(tomorrow.getMonth() + 1).padStart(2, "0"),
    String(tomorrow.getDate()).padStart(2, "0"),
  ].join("-");
  await page.getByLabel("Scheduled").fill(tomorrowValue);
  await page.getByLabel("Projects").fill("mdbase");
  await page.getByLabel("Contexts").fill("computer");
  await page.getByLabel("Tags").fill("release, planning");
  await page.getByLabel("Repeat").selectOption("weekly");
  await page
    .getByLabel("Reminder date and time")
    .fill(`${tomorrowValue}T09:00`);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();

  await page.getByRole("button", { name: "Upcoming" }).click();
  await expect(
    page.getByText("Prepare weekly review", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByLabel("Search tasks").fill("mdbase computer release");
  await expect(
    page.getByText("Prepare weekly review", { exact: true }),
  ).toBeVisible();
});

test("creates, edits, searches, completes, and reloads a Markdown task", async ({
  page,
}) => {
  await page.getByLabel("New task title").fill("Review Capacitor storage");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText("Review Capacitor storage", { exact: true }),
  ).toBeVisible();

  await page.getByText("Review Capacitor storage", { exact: true }).click();
  const title = page.getByLabel("Task title");
  await title.fill("Review web-native storage");
  await page.getByText("Normal", { exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();

  await page.getByRole("button", { name: "Search" }).click();
  await page.getByLabel("Search tasks").fill("web-native");
  await expect(
    page.getByText("Review web-native storage", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Complete Review web-native storage" })
    .click();
  await expect(
    page.getByRole("button", { name: "Reopen Review web-native storage" }),
  ).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByLabel("Search tasks").fill("web-native");
  await expect(
    page.getByText("Review web-native storage", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reopen Review web-native storage" }),
  ).toBeVisible();
});

test("saves in the background while navigating away", async ({ page }) => {
  await page.getByLabel("New task title").fill("Background save");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("Background save", { exact: true }).click();
  await page.getByLabel("Task title").fill("Background save completed");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(
    page.getByText("Background save completed", { exact: true }),
  ).toBeVisible();
});
