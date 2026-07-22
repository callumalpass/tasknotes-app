import type { JsonObject } from "@mdbase/connect";
import { buildTaskNotesMdbaseResources } from "@tasknotes/model/mdbase";
import { expect, test } from "@playwright/test";

import { TaskNotesTaskModel } from "../src/domain/tasknotes-model";

test("opens an ordinary relay collection without requiring hosted sync", async ({
  page,
}) => {
  const operations: string[] = [];
  const task = new TaskNotesTaskModel().create(
    { title: "Task from the relay" },
    { id: "relay-task", now: "2026-07-22T00:00:00.000Z" },
  );
  await page.route(
    "https://connect.mdbase.dev/v1/collections/**/operations/**",
    async (route) => {
      const operation = new URL(route.request().url()).pathname
        .split("/")
        .at(-1)!;
      operations.push(operation);
      const result =
        operation === "describe"
          ? collectionDescription()
          : operation === "query"
            ? {
                valid: true,
                diagnostics: [],
                result: {
                  results: [
                    {
                      path: task.path,
                      frontmatter: task.frontmatter,
                      body: task.body,
                      types: ["task"],
                    },
                  ],
                  meta: { total_count: 1, has_more: false },
                },
              }
            : { valid: true, diagnostics: [], result: {} };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ result }),
      });
    },
  );

  await page.goto("./");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("tasknotes:collection-choice:v1", "cloud");
    const manifestUrl = new URL(
      ".well-known/mdbase-app.json",
      new URL("./", location.href),
    ).href;
    localStorage.setItem(
      `mdbase-connect:token:https://connect.mdbase.dev:${manifestUrl}`,
      JSON.stringify({
        accessToken: "mdb_local",
        refreshToken: "ref_local",
        clientId: "01911111-1111-7111-8111-111111111111",
        collectionId: "01922222-2222-7222-8222-222222222222",
        operations: [
          "describe",
          "changes",
          "read",
          "query",
          "create",
          "update",
          "delete",
          "rename",
        ],
        scope: { contracts: [{ id: "tasknotes.task", version: 1 }] },
        expiresAt: Date.now() + 60_000,
        refreshExpiresAt: Date.now() + 120_000,
      }),
    );
  });

  await page.reload();

  await expect(page.getByText("Task from the relay")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "TaskNotes could not open." }),
  ).toHaveCount(0);
  expect(operations).toContain("describe");
  expect(operations).toContain("query");

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Change collection" }).click();
  await expect(
    page.getByRole("heading", { name: "Open your TaskNotes collection." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue to mdbase" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => ({
      choice: localStorage.getItem("tasknotes:collection-choice:v1"),
      hasConnection: Object.keys(localStorage).some((key) =>
        key.startsWith("mdbase-connect:token:"),
      ),
    })),
  ).toEqual({ choice: "cloud", hasConnection: false });

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Open your TaskNotes collection." }),
  ).toBeVisible();
});

function collectionDescription() {
  const generated = buildTaskNotesMdbaseResources({ profiles: ["core-lite"] });
  const type = generated.type as unknown as {
    schema: { value: JsonObject };
    collection?: JsonObject;
    "x-tasknotes": JsonObject;
  };
  return {
    protocol_version: 2,
    collection_id: "01922222-2222-7222-8222-222222222222",
    display_name: "Relay tasks",
    spec_version: "0.3.0",
    operations: ["describe", "query", "read", "create", "update", "delete"],
    change_cursor: 0,
    types: [
      {
        name: "task",
        version: 1,
        schema: type.schema.value,
        collection: type.collection,
        extensions: { "x-tasknotes": type["x-tasknotes"] },
      },
    ],
    contracts: [
      {
        id: "tasknotes.task",
        version: 1,
        type_name: "task",
        extension: "x-tasknotes",
        configuration: type["x-tasknotes"],
      },
    ],
  };
}
