import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { chromium, expect } from "@playwright/test";
import { parse } from "yaml";

process.env.NODE_ENV = "test";

const appRoot = resolve(import.meta.dirname, "..");
const connectRoot = resolve(
  process.env.TASKNOTES_CONNECT_ROOT ?? resolve(appRoot, "../mdbase-connect"),
);
const { buildApp } = await import(`${connectRoot}/services/server/dist/app.js`);
const { createDatabase } = await import(
  `${connectRoot}/services/server/dist/db.js`
);
const { hostedResources } = await import(
  `${connectRoot}/services/server/dist/hosted.js`
);
const { MemoryHostedAuthority, MemoryReplicaStore, OfflineReplica, SyncError } =
  await import(`${connectRoot}/packages/sync/dist/index.js`);

const appPort = await availablePort();
const controlPort = await availablePort();
const appUrl = `http://127.0.0.1:${appPort}`;
const controlUrl = `http://127.0.0.1:${controlPort}`;
const provider = await startMemoryProvider();
const execute = promisify(execFile);
const database = await createDatabase("memory");
const { app: control } = await buildApp({
  db: database,
  devAuth: true,
  hostedCollections: true,
  hostedProvider: provider.client,
  allowInsecureManifests: true,
  publicUrl: controlUrl,
  portalDist: resolve(connectRoot, "apps/portal/dist"),
});
let vite;
let browser;

try {
  await control.listen({ host: "127.0.0.1", port: controlPort });
  const developmentEnvironment = {
    ...process.env,
    TASKNOTES_APP_URL: appUrl,
    TASKNOTES_WEB_ONLY: "1",
    VITE_MDBASE_CONNECT_URL: controlUrl,
  };
  await execute("pnpm", ["manifest:dev"], {
    cwd: appRoot,
    env: developmentEnvironment,
  });
  vite = spawn(
    "pnpm",
    [
      "exec",
      "vite",
      "--host",
      "127.0.0.1",
      "--port",
      String(appPort),
      "--strictPort",
    ],
    {
      cwd: appRoot,
      env: developmentEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const viteOutput = [];
  for (const stream of [vite.stdout, vite.stderr])
    stream.on("data", (chunk) => viteOutput.push(chunk.toString()));
  await waitFor(`${appUrl}/.well-known/mdbase-app.json`, viteOutput);

  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  phase("authorizing TaskNotes and creating a hosted collection");
  await page.goto(appUrl);
  await page.getByRole("button", { name: /^mdbase/ }).click();
  await page.getByRole("button", { name: "Continue to mdbase" }).click();
  await expect(page).toHaveURL(new RegExp(`^${escapeRegex(controlUrl)}/login`));
  await page.getByLabel("Name").fill("TaskNotes E2E");
  await page.getByLabel("Email").fill("tasknotes-e2e@example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  const createHostedCollection = page.getByRole("button", {
    name: /^(Create hosted collection|Create an mdbase cloud collection)$/,
  });
  await expect(createHostedCollection).toBeVisible();
  await createHostedCollection.click();
  await page
    .getByRole("textbox", { name: "New collection name" })
    .fill("My collection");
  await page.getByRole("button", { name: "Create collection" }).click();
  await expect(
    page.getByRole("radio", {
      name: /My collection Hosted by mdbase Setup needed/,
    }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Allow TaskNotes" }).click();
  await expect(page).toHaveURL(
    new RegExp(`^${escapeRegex(appUrl)}/?\\?collection=`),
    {
      timeout: 15_000,
    },
  );
  await expect
    .poll(() => new URL(page.url()).searchParams.get("collection"))
    .toMatch(/^[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { name: "Cloud board" }),
  ).toBeVisible();

  phase("creating a task locally and synchronizing it to the authority");
  await page.getByLabel("New task title").fill("Cloud foundation");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText("Cloud foundation", { exact: true }),
  ).toBeVisible();
  await page.getByText("Cloud foundation", { exact: true }).click();
  await page.getByText("Repeat and reminders", { exact: true }).click();
  await page.getByRole("button", { name: "Add reminder" }).click();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowValue = [
    tomorrow.getFullYear(),
    String(tomorrow.getMonth() + 1).padStart(2, "0"),
    String(tomorrow.getDate()).padStart(2, "0"),
  ].join("-");
  await chooseDate(page, "Reminder date", tomorrowValue);
  await chooseTime(page, "Reminder time", "09:00");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect
    .poll(() => provider.timerReconciliations().at(-1)?.timers.length, {
      timeout: 5_000,
    })
    .toBe(1);
  const desiredTimer = provider.timerReconciliations().at(-1).timers[0];
  assert.match(desiredTimer.id, /^[a-f0-9]{64}$/);
  assert.equal(desiredTimer.data, undefined);
  assert.equal(
    JSON.stringify(desiredTimer).includes("Cloud foundation"),
    false,
  );
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText("Up to date", { exact: true })).toBeVisible();

  const hosted = provider.onlyCollection();
  const cloudRecord = hosted.authority
    .serialize()
    .records.find((record) => record.frontmatter.title === "Cloud foundation");
  assert.ok(
    cloudRecord,
    "Task created in the browser did not reach the hosted authority",
  );

  phase("rendering a provider-owned saved view through mdbase cloud");
  await page.getByRole("button", { name: /Saved views/ }).click();
  const cloudView = page
    .getByLabel("Cloud views")
    .getByRole("button", { name: "Cloud board", exact: true });
  await expect(cloudView).toBeVisible();
  await cloudView.click();
  await expect(page.getByLabel("Cloud board board")).toBeVisible();
  await expect(
    page.getByText("Cloud foundation", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Urgency", { exact: true })).toBeVisible();
  await expect(page.getByText("8", { exact: true })).toBeVisible();

  phase("editing the cloud-owned saved-view source through the public API");
  await page.getByRole("button", { name: "Edit Cloud board" }).click();
  const viewEditor = page.getByRole("dialog", { name: "Edit view" });
  await expect(viewEditor).toBeVisible();
  const arrangeSection = viewEditor
    .getByRole("heading", { name: "Arrange", exact: true })
    .locator("..")
    .locator("..")
    .locator("..");
  if ((await arrangeSection.getAttribute("open")) === null)
    await arrangeSection.locator(":scope > summary").click();
  await viewEditor.getByLabel("Property to display").fill("due");
  await viewEditor
    .locator('.add-view-property:has([aria-label="Property to display"])')
    .getByRole("button", { name: "Add", exact: true })
    .click();
  await viewEditor
    .getByRole("button", { name: "Save view", exact: true })
    .click();
  await expect(page.getByLabel("Cloud board board")).toBeVisible();
  const savedView = markdownFrontmatter(provider.viewSource().document)
    .views[0];
  assert.deepEqual(savedView.select, ["status", "urgency", "due"]);
  assert.equal(
    savedView.presentation.type,
    "tasknotes.kanban",
    "Editing displayed properties changed the view layout",
  );
  await page.getByRole("button", { name: "More", exact: true }).click();

  phase("saving immediately while the provider is offline, then resuming sync");
  await page.getByRole("button", { name: "Cloud board" }).click();
  await expect(
    page.getByText("Cloud foundation", { exact: true }),
  ).toBeVisible();
  provider.setOnline(false);
  await page.getByText("Cloud foundation", { exact: true }).click();
  await page
    .getByLabel("Task title", { exact: true })
    .fill("Cloud foundation offline");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({
    timeout: 5_000,
  });
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "More" }).click();
  await expect(page.getByText(/1 change waiting to upload/)).toBeVisible();
  await expect(page.getByText("Offline · changes saved here")).toBeVisible();
  provider.setOnline(true);
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText("Up to date", { exact: true })).toBeVisible();
  assert.equal(
    hosted.authority.serialize().records[0]?.frontmatter.title,
    "Cloud foundation offline",
  );

  phase("surfacing and resolving a real two-device conflict");
  const laptopReplicaId = crypto.randomUUID();
  hosted.authority.registerReplica({
    id: laptopReplicaId,
    name: "E2E laptop",
    mode: "read_write",
    allowedTypes: ["task"],
  });
  const laptop = new OfflineReplica(
    hosted.authority.transport(laptopReplicaId),
    new MemoryReplicaStore({
      replicaId: laptopReplicaId,
      records: {},
      pending: [],
      conflicts: {},
    }),
  );
  await laptop.initialize();
  await page.getByRole("button", { name: "Cloud board" }).click();
  await expect(
    page.getByText("Cloud foundation offline", { exact: true }),
  ).toBeVisible();
  provider.setOnline(false);
  await page.getByText("Cloud foundation offline", { exact: true }).click();
  await page.getByLabel("Task title", { exact: true }).fill("Phone version");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({
    timeout: 5_000,
  });
  await laptop.queueUpdate({
    recordId: cloudRecord.record_id,
    patch: { title: "Laptop version" },
  });
  await laptop.sync();
  provider.setOnline(true);
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(
    page.getByRole("heading", { name: "Sync issues" }),
  ).toBeVisible();
  await expect(page.getByText("Phone version", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Keep this device" }).click();
  await expect(page.getByRole("heading", { name: "Sync issues" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Sync now" }).click();
  await laptop.pull();
  assert.equal(
    (await laptop.records()).find(
      (record) => record.record_id === cloudRecord.record_id,
    )?.frontmatter.title,
    "Phone version",
  );

  phase("reopening the cached collection after a page reload");
  await page.reload();
  await expect(page.getByRole("heading", { name: "More" })).toBeVisible();
  await page.getByRole("button", { name: "Cloud board" }).click();
  await expect(page.getByText("Phone version", { exact: true })).toBeVisible();

  phase("reopening cached saved views while the provider is offline");
  await page.getByRole("button", { name: "More" }).click();
  provider.setOnline(false);
  await page.reload();
  await expect(page.getByRole("heading", { name: "More" })).toBeVisible();
  await page.getByRole("button", { name: /Saved views/ }).click();
  const cachedCloudView = page
    .getByLabel("Cloud views")
    .getByRole("button", { name: "Cloud board", exact: true });
  await expect(cachedCloudView).toBeVisible();
  await cachedCloudView.click();
  await expect(page.getByText("Last available result")).toBeVisible();
  await expect(page.getByText("Phone version", { exact: true })).toBeVisible();
  provider.setOnline(true);
  process.stdout.write("TaskNotes cloud browser vertical slice passed\n");
} finally {
  provider.setOnline(true);
  if (browser) await browser.close();
  if (vite) {
    vite.kill("SIGTERM");
    await Promise.race([
      new Promise((resolveExit) => vite.once("exit", resolveExit)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
    ]);
  }
  await execute("pnpm", ["manifest"], { cwd: appRoot }).catch(() => undefined);
  await control.close().catch(() => undefined);
  await database.end().catch(() => undefined);
  await provider.close();
}

async function startMemoryProvider() {
  const collections = new Map();
  const replicas = new Map();
  const tokens = new Map();
  const timerReconciliations = [];
  let online = true;
  const server = createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader(
      "access-control-allow-headers",
      "authorization,content-type",
    );
    response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    if (!online) {
      send(response, 503, error("offline", "The test provider is offline."));
      return;
    }
    try {
      const url = new URL(request.url ?? "/", "http://provider");
      const match = url.pathname.match(
        /^\/v1\/hosted\/collections\/([^/]+)\/sync\/(sessions|snapshot|changes|mutations)$/,
      );
      const operationMatch = url.pathname.match(
        /^\/v1\/hosted\/collections\/([^/]+)\/operations\/(list_views|execute_view|read_view_source|create_view_source|update_view_source|delete_view_source|reconcile_timers)$/,
      );
      if (!match && !operationMatch) {
        send(response, 404, error("not_found", "Not found."));
        return;
      }
      const collectionId = (match ?? operationMatch)[1];
      const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const enrollment = bearer ? tokens.get(bearer) : undefined;
      if (!enrollment || enrollment.collectionId !== collectionId) {
        send(response, 401, error("invalid_replica_token", "Invalid token."));
        return;
      }
      if (
        enrollment.allowedOrigin &&
        request.headers.origin &&
        request.headers.origin !== enrollment.allowedOrigin
      ) {
        send(response, 403, error("origin_denied", "Origin is not allowed."));
        return;
      }
      const authority = collections.get(collectionId)?.authority;
      if (!authority)
        throw new SyncError("collection_not_found", "Collection not found.");
      if (operationMatch) {
        const input = await requestJson(request);
        const operation = operationMatch[2];
        if (!enrollment.allowedOperations?.includes(operation)) {
          throw new SyncError(
            "insufficient_access",
            "Operation is not authorized.",
          );
        }
        if (operation === "reconcile_timers") {
          timerReconciliations.push(structuredClone(input));
          const now = new Date().toISOString();
          send(response, 200, {
            result: {
              namespace: input.namespace,
              timers: input.timers.map((timer) => ({
                ...timer,
                criterion_id: input.criterion_id,
                generation: 1,
                status: "scheduled",
                created_at: now,
                updated_at: now,
                fired_at: null,
              })),
              cancelled_ids: [],
            },
          });
        } else if (operation === "list_views") {
          send(response, 200, { result: cloudViewList(viewSource) });
        } else if (operation === "execute_view") {
          send(response, 200, {
            result: cloudViewExecution(authority.serialize().records),
          });
        } else if (operation === "read_view_source") {
          if (input.path !== viewSource.path)
            throw new SyncError("view_not_found", "View source not found.");
          send(response, 200, { result: valid(viewSource) });
        } else if (operation === "create_view_source") {
          throw new SyncError(
            "already_exists",
            "The test view already exists.",
          );
        } else if (operation === "update_view_source") {
          if (input.path !== viewSource.path)
            throw new SyncError("view_not_found", "View source not found.");
          if (input.if_revision !== viewSource.revision)
            throw new SyncError("revision_conflict", "Revision conflict.");
          viewSource = {
            ...viewSource,
            revision: `cloud-view-${++viewRevision}`,
            document: input.document,
          };
          send(response, 200, { result: valid(viewSource) });
        } else {
          if (input.path !== viewSource.path)
            throw new SyncError("view_not_found", "View source not found.");
          if (input.if_revision !== viewSource.revision)
            throw new SyncError("revision_conflict", "Revision conflict.");
          send(response, 200, {
            result: valid({ path: viewSource.path, deleted: true }),
          });
        }
        return;
      }
      const transport = authority.transport(enrollment.replicaId);
      let value;
      if (match[2] === "sessions") value = await transport.openSession();
      else if (match[2] === "snapshot")
        value = await transport.snapshot(
          url.searchParams.get("snapshot_id"),
          url.searchParams.get("page") ?? undefined,
        );
      else if (match[2] === "changes")
        value = await transport.changes(
          Number(url.searchParams.get("after")),
          Number(url.searchParams.get("limit")),
        );
      else value = await transport.mutate(await requestJson(request));
      send(response, 200, value);
    } catch (reason) {
      const code = reason instanceof SyncError ? reason.code : "provider_error";
      send(
        response,
        400,
        error(code, reason instanceof Error ? reason.message : String(reason)),
      );
    }
  });
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Provider did not start");
  const url = `http://127.0.0.1:${address.port}`;
  let viewRevision = 1;
  let viewSource = cloudViewSource();

  function removeReplicaTokens(replicaId) {
    for (const [token, value] of tokens)
      if (value.replicaId === replicaId) tokens.delete(token);
  }

  return {
    client: {
      url,
      ready: async () => undefined,
      createCollection: async (collectionId, template, displayName) => {
        collections.set(collectionId, {
          displayName,
          authority: new MemoryHostedAuthority({
            id: collectionId,
            resources: hostedResources(template),
          }),
        });
      },
      renameCollection: async (collectionId, displayName) => {
        collections.get(collectionId).displayName = displayName;
      },
      deleteCollection: async (collectionId) => {
        collections.delete(collectionId);
      },
      provisionTypes: async (collectionId, provisions) => {
        const collection = collections.get(collectionId);
        if (!collection) throw new Error("Collection not found");
        const resources = provisionedResources(
          collection.authority.serialize().resources,
          provisions,
        );
        collection.authority = new MemoryHostedAuthority({
          id: collectionId,
          resources,
        });
        return resources.contracts;
      },
      registerReplica: async (collectionId, replica) => {
        const collection = collections.get(collectionId);
        if (!collection) throw new Error("Collection not found");
        collection.authority.registerReplica({
          id: replica.id,
          name: replica.name,
          mode: replica.mode,
          allowedTypes: replica.allowedTypes,
        });
        replicas.set(replica.id, { collectionId, ...replica });
        tokens.set(replica.token, {
          collectionId,
          replicaId: replica.id,
          allowedOrigin: replica.allowedOrigin,
          allowedOperations: replica.allowedOperations,
        });
      },
      rotateReplicaToken: async (replicaId, token) => {
        const replica = replicas.get(replicaId);
        if (!replica) throw new Error("Replica not found");
        removeReplicaTokens(replicaId);
        tokens.set(token, {
          collectionId: replica.collectionId,
          replicaId,
          allowedOrigin: replica.allowedOrigin,
          allowedOperations: replica.allowedOperations,
        });
      },
      updateApplicationReplica: async (replicaId, policy) => {
        const replica = replicas.get(replicaId);
        collections
          .get(replica.collectionId)
          .authority.updateReplicaScope(replicaId, policy.allowedTypes);
      },
      revokeReplica: async (replicaId) => {
        const replica = replicas.get(replicaId);
        if (replica)
          collections
            .get(replica.collectionId)
            .authority.revokeReplica(replicaId);
        removeReplicaTokens(replicaId);
      },
      compactThrough: async (collectionId, sequence) => {
        collections.get(collectionId).authority.compactThrough(sequence);
      },
      upsertNotificationGrant: async () => undefined,
      revokeNotificationGrant: async () => undefined,
    },
    setOnline(value) {
      online = value;
    },
    viewSource() {
      return structuredClone(viewSource);
    },
    timerReconciliations() {
      return structuredClone(timerReconciliations);
    },
    onlyCollection() {
      assert.equal(collections.size, 1, "Expected one hosted collection");
      return collections.values().next().value;
    },
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

async function chooseDate(page, label, value) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.locator(`[data-date="${value}"]`).last().click();
}

async function chooseTime(page, label, value) {
  const [hour, minute] = value.split(":");
  await page.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: label, exact: true });
  await dialog
    .getByRole("listbox", { name: "Hour" })
    .getByRole("option", { name: hour, exact: true })
    .click();
  await dialog
    .getByRole("listbox", { name: "Minute" })
    .getByRole("option", { name: minute, exact: true })
    .click();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Port unavailable");
  const port = address.port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitFor(url, output) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The development server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`TaskNotes did not start.\n${output.join("")}`);
}

async function requestJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function cloudViewSource() {
  return {
    path: "Views/cloud.md",
    format: "mdbase.view",
    revision: "cloud-view-1",
    document: `---
type: view
id: cloud.views
version: 1
name: Cloud views
query:
  types: [task]
views:
  - id: board
    name: Cloud board
    select: [status, urgency]
    group_by:
      - field: status
        direction: asc
    presentation:
      type: tasknotes.kanban
      fallback: mdbase.table
      mappings:
        column: status
---
`,
  };
}

function markdownFrontmatter(document) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(document);
  assert.ok(match, "Expected a Markdown frontmatter document");
  return parse(match[1]);
}

function provisionedResources(resources, provisions) {
  const types = [...(resources?.types ?? [])];
  const contracts = [...(resources?.contracts ?? [])];
  const documents = [...(resources?.documents ?? [])];
  for (const provision of provisions) {
    const definition = markdownFrontmatter(provision.document);
    const extensions = Object.fromEntries(
      Object.entries(definition).filter(
        ([key, value]) =>
          key.startsWith("x-") &&
          value !== null &&
          typeof value === "object" &&
          !Array.isArray(value),
      ),
    );
    const typeName = definition.name ?? provision.name;
    types.push({
      name: typeName,
      version: definition.version ?? 1,
      schema: definition.schema?.value ?? {},
      collection: definition.collection,
      definition,
      extensions,
    });
    documents.push({
      path: provision.path,
      kind: "type",
      revision: crypto.randomUUID(),
      document: provision.document,
    });
    for (const provided of provision.provides) {
      const match = Object.entries(extensions).find(
        ([, value]) => value.contract === provided.id,
      );
      if (!match)
        throw new Error(
          `Provisioned type ${typeName} does not define ${provided.id}.`,
        );
      contracts.push({
        id: provided.id,
        version: provided.version,
        type_name: typeName,
        extension: match[0],
        configuration: match[1],
      });
    }
  }
  return {
    revision: crypto.randomUUID(),
    spec_version: resources?.spec_version ?? "0.3.0",
    types,
    contracts,
    documents,
  };
}

function cloudViewList(source) {
  const name =
    source.document.match(/\n\s+name:\s+([^\n]+)/)?.[1]?.trim() ??
    "Cloud board";
  return {
    valid: true,
    result: {
      views: [
        {
          id: "cloud.views",
          name: "Cloud views",
          source: {
            path: source.path,
            format: source.format,
            revision: source.revision,
            writable: true,
          },
          views: [
            {
              id: "board",
              name,
              properties: [
                { key: "status", label: "State" },
                { key: "urgency", label: "Urgency" },
              ],
              presentation: {
                type: "tasknotes.kanban",
                fallback: "mdbase.table",
                mappings: { column: "status" },
                options: {},
              },
            },
          ],
        },
      ],
      meta: { total_count: 1 },
    },
    diagnostics: [],
  };
}

function valid(result) {
  return { valid: true, result, diagnostics: [] };
}

function cloudViewExecution(records) {
  const tasks = records.filter((record) => record.types.includes("task"));
  const groups = new Map();
  for (const record of tasks) {
    const status = record.frontmatter.status ?? null;
    groups.set(status, (groups.get(status) ?? 0) + 1);
  }
  return {
    valid: true,
    result: {
      results: tasks.map((record) => ({
        path: record.path,
        frontmatter: record.frontmatter,
        raw_frontmatter: record.frontmatter,
        body: record.body,
        types: record.types,
        values: {
          status: record.frontmatter.status ?? null,
          urgency: record.frontmatter.title === "Cloud foundation" ? 8 : 1,
        },
      })),
      meta: {
        total_count: tasks.length,
        has_more: false,
        view: { path: "Views/cloud.md", id: "board" },
        context: null,
        groups: [...groups].map(([status, count]) => ({
          values: { status },
          count,
          summaries: {},
        })),
      },
    },
    diagnostics: [],
  };
}

function send(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function error(code, message) {
  return { error: { code, message } };
}

function phase(value) {
  process.stdout.write(`${value}\n`);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
