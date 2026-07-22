import { expect, test } from "@playwright/test";

test("recovers from a saved connection without hosted sync", async ({
  page,
}) => {
  await page.goto("./");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("tasknotes:collection-choice:v1", "cloud");
    const manifestUrl = `${location.origin}/.well-known/mdbase-app.json`;
    localStorage.setItem(
      `mdbase-connect:token:https://connect.mdbase.dev:${manifestUrl}`,
      JSON.stringify({
        accessToken: "mdb_local",
        refreshToken: "ref_local",
        clientId: "01911111-1111-7111-8111-111111111111",
        collectionId: "01922222-2222-7222-8222-222222222222",
        operations: ["read", "query"],
        scope: { contracts: [{ id: "tasknotes.task", version: 1 }] },
        expiresAt: Date.now() + 60_000,
        refreshExpiresAt: Date.now() + 120_000,
      }),
    );
  });

  await page.reload();

  await expect(
    page.getByText(
      "This saved connection does not support cloud sync. Choose an mdbase cloud collection.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue to mdbase" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "TaskNotes could not open." }),
  ).toHaveCount(0);
});
