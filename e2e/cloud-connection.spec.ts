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
            : operation === "list_views"
              ? valid(defaultViewDocuments())
              : operation === "execute_view"
                ? valid(
                    defaultViewExecution([
                      {
                        path: task.path,
                        frontmatter: task.frontmatter,
                        body: task.body,
                        types: ["task"],
                      },
                    ]),
                  )
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
          "list_views",
          "execute_view",
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

test("acknowledges slow relay creates and prefetches revisions before delete", async ({
  page,
}) => {
  const model = new TaskNotesTaskModel();
  const existing = model.create(
    { title: "Delete over the relay" },
    { id: "relay-delete", now: "2026-07-22T00:00:00.000Z" },
  );
  let records = [
    {
      path: existing.path,
      frontmatter: existing.frontmatter as JsonObject,
      body: existing.body,
      types: ["task"],
      revision: "revision-1",
    },
  ];
  const createGate = deferred();
  const readGate = deferred();
  let createRequests = 0;
  let readRequests = 0;
  let deleteRequests = 0;

  await page.route(
    "https://connect.mdbase.dev/v1/collections/**/operations/**",
    async (route) => {
      const operation = new URL(route.request().url()).pathname
        .split("/")
        .at(-1)!;
      let result: unknown;
      if (operation === "describe") result = collectionDescription();
      else if (operation === "query") {
        result = valid({
          results: records.map((record) => ({
            path: record.path,
            frontmatter: record.frontmatter,
            body: record.body,
            types: record.types,
          })),
          meta: { total_count: records.length, has_more: false },
        });
      } else if (operation === "list_views") {
        result = valid(defaultViewDocuments());
      } else if (operation === "execute_view") {
        result = valid(defaultViewExecution(records));
      } else if (operation === "create") {
        createRequests += 1;
        const input = route.request().postDataJSON() as {
          path: string;
          frontmatter: JsonObject;
          body: string;
        };
        await createGate.promise;
        const created = {
          ...input,
          types: ["task"],
          revision: "revision-2",
        };
        records.push(created);
        result = valid(created);
      } else if (operation === "read") {
        readRequests += 1;
        await readGate.promise;
        result = valid(records[0]);
      } else if (operation === "delete") {
        deleteRequests += 1;
        records = records.slice(1);
        result = valid({
          path: existing.path,
          deleted: true,
          broken_links: [],
        });
      } else result = valid({});
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ result }),
      });
    },
  );

  await installRelayAuthorization(page, [
    "describe",
    "query",
    "read",
    "create",
    "delete",
    "list_views",
    "execute_view",
  ]);
  await page.reload();
  await expect(page.getByText("Delete over the relay")).toBeVisible();

  const input = page.getByLabel("New task title");
  await input.fill("Create over the relay");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect.poll(() => createRequests).toBe(1);
  await expect(page.getByText("Adding “Create over the relay”…")).toBeVisible();
  await expect(input).toHaveValue("");

  createGate.resolve();
  await expect(page.getByText("Create over the relay")).toBeVisible();

  await page
    .getByRole("button", { name: "Task actions for Delete over the relay" })
    .click();
  await expect.poll(() => readRequests).toBe(1);
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete permanently" }).click();
  expect(deleteRequests).toBe(0);

  readGate.resolve();
  await expect.poll(() => deleteRequests).toBe(1);
  await expect(page.getByText("Delete over the relay")).toHaveCount(0);
  expect(readRequests).toBe(1);
});

test("restores a custom home view and its cached rows before relay refresh", async ({
  page,
}) => {
  const collectionId = "01933333-3333-7333-8333-333333333333";
  const task = new TaskNotesTaskModel().create(
    { title: "Visible from cached home" },
    { id: "cached-home-task", now: "2026-07-22T00:00:00.000Z" },
  );
  const coldCatalog = deferred();
  const warmRefresh = deferred();
  let warm = false;

  await page.route(
    "https://connect.mdbase.dev/v1/collections/**/operations/**",
    async (route) => {
      const operation = new URL(route.request().url()).pathname
        .split("/")
        .at(-1)!;
      let result: unknown;
      if (operation === "describe") {
        result = {
          ...collectionDescription(),
          collection_id: collectionId,
          operations: [
            "describe",
            "query",
            "list_views",
            "execute_view",
            "read_view_source",
          ],
        };
      } else if (operation === "query") {
        result = valid({
          results: [
            {
              path: task.path,
              frontmatter: task.frontmatter,
              body: task.body,
              types: ["task"],
            },
          ],
          meta: { total_count: 1, has_more: false },
        });
      } else if (operation === "list_views") {
        await (warm ? warmRefresh.promise : coldCatalog.promise);
        result = valid({
          views: [
            {
              id: "work",
              name: "Work",
              source: {
                path: "Views/work.md",
                format: "mdbase.view",
                revision: "view-r1",
                writable: false,
              },
              views: [{ id: "open", name: "Open work" }],
            },
          ],
          meta: { total_count: 1 },
        });
      } else if (operation === "execute_view") {
        if (warm) await warmRefresh.promise;
        result = valid({
          results: [
            {
              path: task.path,
              frontmatter: task.frontmatter,
              body: task.body,
              types: ["task"],
              values: { priority: task.priority },
            },
          ],
          meta: {
            total_count: 1,
            has_more: false,
            view: { path: "Views/work.md", id: "open" },
            groups: [],
          },
        });
      } else if (operation === "read_view_source") {
        result = valid({
          path: "Views/work.md",
          format: "mdbase.view",
          revision: "view-r1",
          document: "---\ntype: view\nname: Work\n---\n",
        });
      } else {
        result = valid({});
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ result }),
      });
    },
  );

  await page.goto("./");
  await page.evaluate(
    async ({ collectionId }) => {
      localStorage.clear();
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(
          `tasknotes-views:${collectionId}`,
        );
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      localStorage.setItem("tasknotes:collection-choice:v1", "cloud");
      localStorage.setItem(
        "tasknotes:navigation-views:v2",
        JSON.stringify({
          "connect:Live connection through mdbase": ["Views/work.md#open"],
        }),
      );
      const manifestUrl = new URL(
        ".well-known/mdbase-app.json",
        new URL("./", location.href),
      ).href;
      localStorage.setItem(
        `mdbase-connect:token:https://connect.mdbase.dev:${manifestUrl}`,
        JSON.stringify({
          accessToken: "mdb_cached_home",
          refreshToken: "ref_cached_home",
          clientId: "01911111-1111-7111-8111-111111111111",
          collectionId,
          operations: [
            "describe",
            "query",
            "list_views",
            "execute_view",
            "read_view_source",
          ],
          scope: { contracts: [{ id: "tasknotes.task", version: 1 }] },
          expiresAt: Date.now() + 60_000,
          refreshExpiresAt: Date.now() + 120_000,
        }),
      );
    },
    { collectionId },
  );

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Opening your view" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toHaveCount(0);

  coldCatalog.resolve();
  await expect(page.getByRole("heading", { name: "Open work" })).toBeVisible();
  await expect(
    page.getByText("Visible from cached home", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Updating", { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate((scope) => {
      const stored = JSON.parse(
        localStorage.getItem("tasknotes:navigation-views:v2") ?? "{}",
      ) as Record<string, string[]>;
      return stored[scope];
    }, `connect:${collectionId}`),
  ).toEqual(["Views/work.md#open"]);

  warm = true;
  await page.reload();
  await expect(page.getByRole("heading", { name: "Open work" })).toBeVisible();
  await expect(
    page.getByText("Visible from cached home", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Updating", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toHaveCount(0);

  warmRefresh.resolve();
  await expect(page.getByText("Updating", { exact: true })).toHaveCount(0);
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
      } else if (operation === "list_views") {
        result = defaultViewDocuments();
      } else if (operation === "execute_view") {
        result = defaultViewExecution([record]);
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
  await expect(page.getByLabel("Status")).toHaveValue("doing");
  await page
    .locator("details.task-form-section > summary")
    .filter({ hasText: /^Organize/ })
    .click();
  await expect(page.getByRole("button", { name: "Right now" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByLabel("Energy level")).toHaveValue("4");
  await expect(page.getByLabel("Client")).toHaveValue("Acme");

  await page
    .getByLabel("Task title", { exact: true })
    .fill("Preserve the collection contract");
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
    operations: [
      "describe",
      "query",
      "read",
      "create",
      "update",
      "delete",
      "list_views",
      "execute_view",
    ],
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
  operations = [
    "describe",
    "query",
    "read",
    "update",
    "list_views",
    "execute_view",
  ],
) {
  await page.goto("./");
  await page.evaluate((authorizedOperations) => {
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
        operations: authorizedOperations,
        scope: { contracts: [{ id: "tasknotes.task", version: 1 }] },
        expiresAt: Date.now() + 60_000,
        refreshExpiresAt: Date.now() + 120_000,
      }),
    );
  }, operations);
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

function valid<T>(result: T) {
  return { valid: true as const, diagnostics: [], result };
}

function defaultViewDocuments() {
  return {
    views: [
      {
        id: "tasknotes-app",
        name: "TaskNotes",
        source: {
          path: "Views/tasknotes-app.md",
          format: "mdbase.view",
          revision: "view-r1",
          writable: false,
        },
        views: [
          {
            id: "today",
            name: "Today",
            properties: [],
            presentation: {
              type: "tasknotes.task-list",
              fallback: "mdbase.table",
              mappings: {},
              options: {},
            },
          },
        ],
      },
    ],
    meta: { total_count: 1 },
  };
}

function defaultViewExecution(
  records: Array<{
    path: string;
    frontmatter: JsonObject;
    body?: string;
    types?: string[];
  }>,
) {
  return {
    results: records.map((record) => ({ ...record, values: {} })),
    meta: {
      total_count: records.length,
      has_more: false,
      view: { path: "Views/tasknotes-app.md", id: "today" },
      groups: [],
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
