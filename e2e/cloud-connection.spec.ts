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

test("edits a contract-defined task without collapsing custom status or fields", async ({
  page,
}) => {
  const configuration = {
    statuses: [
      status("todo", "To do", 1),
      status("doing", "In flight", 2),
      status("done", "Finished", 3, true),
    ],
    priorities: [
      priority("later", "Whenever", 1),
      priority("now", "Right now", 2),
    ],
    defaults: { status: "todo", priority: "later", taskTag: "task" },
    userFields: [
      {
        id: "energy",
        key: "energy",
        displayName: "Energy level",
        type: "number" as const,
      },
      {
        id: "client",
        key: "client",
        displayName: "Client",
        type: "text" as const,
      },
    ],
  };
  const model = new TaskNotesTaskModel(configuration);
  const task = model.create(
    {
      title: "Respect the collection contract",
      priority: "now",
      customProperties: { energy: 4, client: "Acme" },
    },
    { id: "configured-task", now: "2026-07-22T00:00:00.000Z" },
  );
  task.frontmatter.status = "doing";
  let record = {
    path: task.path,
    frontmatter: task.frontmatter as JsonObject,
    body: task.body,
    types: ["task"],
    revision: "revision-1",
  };
  let updateInput: { patch?: JsonObject; body?: string } | undefined;

  await page.route(
    "https://connect.mdbase.dev/v1/collections/**/operations/**",
    async (route) => {
      const operation = new URL(route.request().url()).pathname
        .split("/")
        .at(-1)!;
      let result: unknown;
      if (operation === "describe") result = configuredCollectionDescription();
      else if (operation === "query") {
        result = {
          results: [record],
          meta: { total_count: 1, has_more: false },
        };
      } else if (operation === "read") result = record;
      else if (operation === "update") {
        updateInput = route.request().postDataJSON() as {
          patch?: JsonObject;
          body?: string;
        };
        const frontmatter = { ...record.frontmatter };
        for (const [key, value] of Object.entries(updateInput.patch ?? {})) {
          if (value === null) delete frontmatter[key];
          else frontmatter[key] = value;
        }
        record = {
          ...record,
          frontmatter,
          body: updateInput.body ?? record.body,
          revision: "revision-2",
        };
        result = record;
      } else result = {};
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          result:
            operation === "describe"
              ? result
              : { valid: true, diagnostics: [], result },
        }),
      });
    },
  );
  await installRelayAuthorization(page);
  await page.reload();

  await page
    .getByText("Respect the collection contract", { exact: true })
    .click();
  await expect(page.getByRole("button", { name: "In flight" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Right now" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByLabel("Energy level")).toHaveValue("4");
  await expect(page.getByLabel("Client")).toHaveValue("Acme");

  await page.getByLabel("Task title").fill("Preserve the collection contract");
  await page.getByLabel("Client").fill("");
  await expect.poll(() => updateInput).toBeTruthy();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  expect(updateInput?.patch).toMatchObject({
    title: "Preserve the collection contract",
    client: null,
  });
  expect(updateInput?.patch).not.toHaveProperty("status");
  expect(record.frontmatter.status).toBe("doing");
  expect(record.frontmatter.energy).toBe(4);
  expect(record.frontmatter).not.toHaveProperty("client");
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

function configuredCollectionDescription() {
  const description = collectionDescription();
  const type = description.types[0];
  type.schema = {
    ...type.schema,
    properties: {
      ...(type.schema.properties as JsonObject),
      status: { enum: ["todo", "doing", "done"] },
      priority: { enum: ["later", "now"] },
      energy: { type: "integer", title: "Energy level" },
      client: { type: "string", title: "Client" },
    },
  };
  const tasknotes = type.extensions["x-tasknotes"] as JsonObject;
  tasknotes.status = {
    values: ["todo", "doing", "done"],
    completed_values: ["done"],
    default: "todo",
    definitions: [
      { value: "todo", label: "To do", order: 1 },
      { value: "doing", label: "In flight", order: 2 },
      { value: "done", label: "Finished", order: 3 },
    ],
  };
  tasknotes.priority = {
    values: ["later", "now"],
    default: "later",
    definitions: [
      { value: "later", label: "Whenever", weight: 1 },
      { value: "now", label: "Right now", weight: 2 },
    ],
  };
  description.contracts[0].configuration = tasknotes;
  return description;
}

async function installRelayAuthorization(
  page: import("@playwright/test").Page,
) {
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
        accessToken: "mdb_configured",
        refreshToken: "ref_configured",
        clientId: "01911111-1111-7111-8111-111111111111",
        collectionId: "01922222-2222-7222-8222-222222222222",
        operations: ["describe", "query", "read", "update"],
        scope: { contracts: [{ id: "tasknotes.task", version: 1 }] },
        expiresAt: Date.now() + 60_000,
        refreshExpiresAt: Date.now() + 120_000,
      }),
    );
  });
}

function status(
  value: string,
  label: string,
  order: number,
  isCompleted = false,
) {
  return {
    id: value,
    value,
    label,
    color: "#808080",
    isCompleted,
    order,
    autoArchive: false,
    autoArchiveDelay: 5,
  };
}

function priority(value: string, label: string, weight: number) {
  return { id: value, value, label, color: "#808080", weight };
}
