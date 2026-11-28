import { expect, test } from "./local-test";
import type { smokeDevice } from "../src/test/next-entry-smoke-fixture";

declare global {
  interface Window {
    offlineTestDevice?: ReturnType<typeof smokeDevice>;
  }
}

test("a refused edit survives a pending reload and keeps the peer's other fields", async ({
  page: host,
  context,
}) => {
  test.setTimeout(90_000);
  const id = "shared-task";
  const path = "TaskNotes/shared.md";
  const input = {
    records: [
      {
        path,
        frontmatter: {
          id,
          title: "Shared task",
          status: "open",
          priority: "normal",
          timeEstimate: 25,
          tags: ["task"],
          type: "task",
          mobileRevision: 1,
        },
        body: "Initial notes",
      },
    ],
    slowConfirmation: true,
  };
  // The host owns only the SDK fixture's replica and write ledger. Reloading
  // the app tab destroys its React tree, editor, repository and SDK client.
  await context.addInitScript((input) => {
    window.__TASKNOTES_NEXT_SMOKE__ = input;
    // Resolve on admission. Chromium can install the init script before the
    // opener is available on a newly created document.
    window.__TASKNOTES_OPEN_DEVICE__ = (page) =>
      window.opener.offlineTestDevice.open(page);
  }, input);
  await host.goto("e2e/offline-device.fixture.html");
  await host.waitForFunction(() => !!window.offlineTestDevice);
  const popup = context.waitForEvent("page");
  await host.evaluate(() => {
    window.open("../task/shared-task");
  });
  const page = await popup;
  const open = () =>
    page
      .getByRole("button", { name: "Open synced fixture collection" })
      .click();
  const title = page.getByRole("textbox", { name: "Task title", exact: true });
  const notes = page.getByRole("textbox", { name: "Notes", exact: true });
  await open();
  await page.getByRole("button", { name: "Edit Time" }).click();
  await page.getByLabel("Estimate (minutes)").fill("");
  await notes.fill("Offline body");
  await title.fill("Offline title");
  await title.press("Tab");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__TASKNOTES_NEXT_SMOKE_CONTROL__!.records()[0]?.frontmatter
            .title,
      ),
    )
    .toBe("Offline title");
  await expect(
    page.getByRole("button", {
      name: "Saved on this device; waiting for sync",
    }),
  ).toBeVisible();
  await page.reload();
  await open();
  await expect(
    page.getByRole("button", { name: "Restore unsaved edits" }),
  ).toBeVisible();
  await host.evaluate(async (path) => {
    const { ledger, replica } = window.offlineTestDevice!;
    const rows = await ledger.list();
    if (!rows.length) throw new Error("Missing offline write receipt");
    for (const row of rows) replica.reject(row.mutationId);
    replica.editElsewhere(path, {
      body: "CLI body",
      frontmatter: { title: "CLI title", priority: "high", timeEstimate: 40 },
    });
    replica.stallConfirmations(false);
  }, path);
  await expect(
    page.getByRole("button", { name: "Keep my edit" }),
  ).toBeVisible();
  await expect(notes).toHaveText("Offline body");
  // Explicitly revert to the value seen at open. A baseline diff loses this.
  await notes.fill("Initial notes");
  await page.reload();
  await open();
  await expect(notes).toHaveText("Initial notes");
  await expect(title).toHaveValue("Offline title");
  await page.getByRole("button", { name: "Keep my edit" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const record = window.__TASKNOTES_NEXT_SMOKE_CONTROL__!.records()[0]!;
        return [
          record.frontmatter.title,
          record.body,
          record.frontmatter.priority,
          record.frontmatter.timeEstimate ?? null,
        ];
      }),
    )
    .toEqual(["Offline title", "Initial notes", "high", null]);
  await expect(page.getByRole("button", { name: "Keep my edit" })).toHaveCount(
    0,
  );
});
