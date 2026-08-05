import type { JsonObject } from "@mdbase-dev/connect";
import type { FileCapability } from "@mdbase-dev/connect-protocol";
import { operationsForApplicationCapabilities } from "@mdbase-dev/connect-protocol";
import type { MdbaseAppManifest } from "@mdbase-dev/connect";
import {
  installMdbaseBrowserFixture,
  type MdbaseBrowserFixtureController,
} from "@mdbase-dev/connect-testing";
import {
  buildTaskNotesMdbaseResources,
  TASKNOTES_CONTRACT_DIGEST,
} from "@tasknotes/model/mdbase";
import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model/types";
import { expect, test, type Route } from "@playwright/test";

import { TaskNotesTaskModel } from "../src/domain/tasknotes-model";
import bundledManifest from "../src/generated/mdbase-app.json" with { type: "json" };

const TASKNOTES_COLLECTION_ID = "01922222-2222-7222-8222-222222222222";

test("opens an ordinary relay collection without requiring hosted sync", async ({
  page,
}) => {
  // The route must exist before fixture installation so the specific
  // assessment route registered later wins Playwright's LIFO matching.
  // eslint-disable-next-line prefer-const
  let authorization!: MdbaseBrowserFixtureController;
  const operations: string[] = [];
  const task = new TaskNotesTaskModel().create(
    { title: "Task from the relay" },
    { id: "relay-task", now: "2026-07-22T00:00:00.000Z" },
  );
  await page.route(
    "https://connect.mdbase.dev/v1/authorities/**/operations/**",
    async (route) => {
      const request = await operationRequest(route, authorization);
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
      await fulfillOperation(route, request.request_id, result);
    },
  );

  authorization = await installRelayAuthorization(page);
  await page.reload();

  await expect(page.getByText("Task from the relay")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "TaskNotes could not open." }),
  ).toHaveCount(0);
  expect(operations).toContain("describe");
  expect(operations).toContain("query");

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();
  await expect(page.getByText(/mdbase keeps reminders running/)).toBeVisible();
  await expect(page.getByText(/Hosted collections only/)).toHaveCount(0);
  await page.getByRole("button", { name: "Change collection" }).click();
  await expect(
    page.getByRole("heading", { name: "Collections" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /TaskNotes E2E/ }),
  ).toHaveAttribute("aria-current", "true");
  await expect(
    page.getByRole("button", { name: "Connect another collection" }),
  ).toBeVisible();
  expect(await authorization.isInstalled(page)).toBe(true);

  await page.reload();
  await page.getByRole("button", { name: "Today" }).click();
  await expect(page.getByText("Task from the relay")).toBeVisible();
});

test("acknowledges slow relay creates and prefetches revisions before delete", async ({
  page,
}) => {
  // eslint-disable-next-line prefer-const -- assigned after route registration
  let authorization!: MdbaseBrowserFixtureController;
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
    "https://connect.mdbase.dev/v1/authorities/**/operations/**",
    async (route) => {
      const request = await operationRequest(route, authorization);
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
        const input = request.input as {
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
      await fulfillOperation(route, request.request_id, result);
    },
  );

  authorization = await installRelayAuthorization(page);
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
  await page.getByRole("button", { name: "Delete task" }).click();
  await expect(page.locator(".undo-toast")).toContainText(
    "Deleted “Delete over the relay”",
  );
  expect(deleteRequests).toBe(0);

  readGate.resolve();
  await page
    .getByRole("button", { name: "Task actions for Create over the relay" })
    .click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete task" }).click();
  await expect.poll(() => deleteRequests, { timeout: 12_000 }).toBe(1);
  await expect(page.locator(".undo-toast")).toContainText(
    "Deleted “Create over the relay”",
  );
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Delete over the relay")).toHaveCount(0);
  expect(readRequests).toBe(1);
});

test("edits a contract-defined task without collapsing custom status or fields", async ({
  page,
}) => {
  // eslint-disable-next-line prefer-const -- assigned after route registration
  let authorization!: MdbaseBrowserFixtureController;
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
      {
        id: "owner",
        key: "owner",
        displayName: "Owner",
        type: "text" as const,
      },
      {
        id: "reviewedAt",
        key: "reviewedAt",
        displayName: "Reviewed At",
        type: "text" as const,
      },
      {
        id: "externalId",
        key: "externalId",
        displayName: "External ID",
        type: "text" as const,
      },
    ],
  };
  const model = new TaskNotesTaskModel(configuration);
  const task = model.create(
    {
      title: "Respect the collection contract",
      priority: "now",
      customProperties: {
        energy: 4,
        client: "Acme",
        owner: "Alex",
        reviewedAt: "2026-07-22T10:00:00Z",
        externalId: "server-owned",
      },
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
    "https://connect.mdbase.dev/v1/authorities/**/operations/**",
    async (route) => {
      const request = await operationRequest(route, authorization);
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
        updateInput = request.input as {
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
      await fulfillOperation(
        route,
        request.request_id,
        operation === "describe"
          ? result
          : { valid: true, diagnostics: [], result },
      );
    },
  );
  authorization = await installRelayAuthorization(page);
  await page.reload();

  await page
    .getByText("Respect the collection contract", { exact: true })
    .click();
  await expect(page.getByLabel("Status")).toHaveAttribute(
    "data-value",
    "doing",
  );
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
  await expect(page.getByRole("combobox", { name: "Owner *" })).toHaveAttribute(
    "data-value",
    "Alex",
  );
  await expect(
    page.getByRole("button", { name: "Reviewed At date" }),
  ).toHaveAttribute("data-value", "2026-07-22");
  await expect(page.getByLabel("External ID")).toHaveAttribute("readonly", "");

  await page
    .getByLabel("Task title", { exact: true })
    .fill("Preserve the collection contract");
  await page.getByLabel("Client").fill("");
  await page.getByRole("combobox", { name: "Owner *" }).click();
  await page.getByRole("option").filter({ hasText: "Sam" }).click();
  await expect.poll(() => updateInput).toBeTruthy();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  expect(updateInput?.patch).toMatchObject({
    title: "Preserve the collection contract",
    client: null,
    owner: "Sam",
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
    implements: Array<{
      contract: string;
      version: string;
      fields: Record<string, string>;
      binding: JsonObject;
    }>;
  };
  const implementation = type.implements.find(
    (candidate) =>
      candidate.contract === "tasknotes.task" &&
      candidate.version === TASKNOTES_SPEC_VERSION,
  )!;
  return {
    protocol_version: 1,
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
        definition: generated.type,
        extensions: {},
      },
    ],
    contracts: [
      {
        contract_type: "record" as const,
        id: "tasknotes.task",
        version: TASKNOTES_SPEC_VERSION,
        digest: TASKNOTES_CONTRACT_DIGEST,
        schema: generated.taskSchema,
        binding_schema: generated.bindingSchema,
        implementations: [
          {
            type_name: "task",
            type_version: 1,
            digest: `sha256:${"1".repeat(64)}`,
            fields: implementation.fields,
            binding: structuredClone(implementation.binding),
          },
        ],
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
      owner: { type: "string", title: "Owner", enum: ["Alex", "Sam"] },
      reviewedAt: {
        type: "string",
        title: "Reviewed At",
        format: "date-time",
      },
      externalId: {
        type: "string",
        title: "External ID",
        readOnly: true,
      },
    },
    required: [...((type.schema.required as string[]) ?? []), "owner"],
  };
  const tasknotes = description.contracts[0].implementations[0]
    .binding as JsonObject;
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
  description.contracts[0].implementations[0].binding = tasknotes;
  return description;
}

function tasknotesGrantContract() {
  return collectionDescription().contracts[0];
}

async function installRelayAuthorization(
  page: import("@playwright/test").Page,
) {
  await page.route(
    "https://connect.mdbase.dev/v1/apps/register",
    async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        manifest: {
          manifest_version: 1,
          id: bundledManifest.id,
        },
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          application: {
            id: "01922222-2222-7222-8222-222222222221",
            family_identity: `bundle:${bundledManifest.id}`,
            manifest_digest: "0".repeat(64),
            name: bundledManifest.name,
            distribution: "web",
            homepage: bundledManifest.homepage,
            requirements: bundledManifest.requirements,
          },
        }),
      });
    },
  );
  await page.goto("./");
  const fixture = await installMdbaseBrowserFixture(page, {
    serverUrl: "https://connect.mdbase.dev",
    application: { manifest: bundledManifest as MdbaseAppManifest },
    collection: {
      id: TASKNOTES_COLLECTION_ID,
      name: "TaskNotes E2E",
      operations: liveConnectorOperations(),
      scope: {
        contracts: [tasknotesGrantContract()],
        access: "full_collection",
      },
      fileCapability: tasknotesFileCapability(),
    },
    authority: { kind: "connector" },
  });
  await page.evaluate((collectionId) => {
    localStorage.setItem("tasknotes:collection-choice:v1", "cloud");
    history.replaceState(null, "", `?collection=${collectionId}`);
  }, TASKNOTES_COLLECTION_ID);
  await page.route(
    "https://connect.mdbase.dev/v1/authorities/**/operations/assess_collection_setup",
    async (route) => {
      const request = await operationRequest(route, fixture);
      await fulfillOperation(
        route,
        request.request_id,
        valid(currentCollectionSetup(request.input)),
      );
    },
  );
  return fixture;
}

function liveConnectorOperations() {
  return operationsForApplicationCapabilities(
    (bundledManifest as MdbaseAppManifest).requirements!.capabilities!,
  ).filter((operation) => operation !== "sync");
}

function tasknotesFileCapability(): FileCapability {
  return {
    kind: "files" as const,
    protocol_version: 1 as const,
    actions: ["list", "read", "add", "replace", "move", "delete"],
    scope: { kind: "collection" as const },
  };
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

const relayRequests = new WeakMap<
  Route,
  {
    fixture: MdbaseBrowserFixtureController;
    request: import("@mdbase-dev/connect-protocol").EncryptedRelayOperationRequest;
  }
>();

async function operationRequest(
  route: Route,
  fixture: MdbaseBrowserFixtureController,
): Promise<{
  protocol_version: 1;
  request_id: string;
  input: JsonObject;
}> {
  if (!fixture.relay)
    throw new Error("The connector relay fixture is unavailable.");
  const operation = await fixture.relay.decrypt(route.request().postDataJSON());
  expect(new URL(route.request().url()).pathname.split("/").at(-1)).toBe(
    operation.operation,
  );
  expect(operation.input).toEqual(expect.any(Object));
  relayRequests.set(route, { fixture, request: operation.request });
  return {
    protocol_version: 1,
    request_id: operation.request.request_id,
    input: operation.input as JsonObject,
  };
}

async function fulfillOperation(
  route: Route,
  requestId: string,
  result: unknown,
): Promise<void> {
  const relay = relayRequests.get(route);
  if (!relay?.fixture.relay || relay.request.request_id !== requestId) {
    throw new Error("The encrypted relay request is unavailable.");
  }
  const envelope = await relay.fixture.relay.success(relay.request, result);
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ envelope }),
  });
}

function defaultViewDocuments() {
  return {
    views: ["today", "upcoming", "calendar", "projects", "archive"].map(
      (id) => ({
        id,
        name: id,
        source: {
          path: `views/tasknotes/${id}.base`,
          format: "obsidian.base",
          revision: "view-r1",
          writable: false,
        },
        views: [
          {
            id,
            name: `${id[0].toUpperCase()}${id.slice(1)}`,
            properties: [],
            presentation: {
              type: "tasknotes.task-list",
              fallback: "mdbase.table",
              mappings: {},
              options: {},
            },
          },
        ],
      }),
    ),
    meta: { total_count: 5 },
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
    results: records.map(({ frontmatter, ...record }) => ({
      ...record,
      effective_frontmatter: frontmatter,
      values: {},
    })),
    meta: {
      total_count: records.length,
      has_more: false,
      view: { path: "views/tasknotes/today.base", id: "today" },
      groups: [],
    },
  };
}

function currentCollectionSetup(input: JsonObject) {
  const digest = `sha256:${"a".repeat(64)}`;
  return {
    status: "current",
    applicable: true,
    application_id: input.application_id,
    declaration_digest: input.declaration_digest,
    provision_digest: digest,
    collection_revision: digest,
    final_collection_revision: digest,
    configuration: [
      {
        requirement: "tasknotes-base-sources",
        path: "/x-obsidian/bases/include",
        value: "views/tasknotes/**/*.base",
        action: "current",
      },
    ],
    type_packs: [],
    final_resource_revisions: {},
    assessment_digest: digest,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
