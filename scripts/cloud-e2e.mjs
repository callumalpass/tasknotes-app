import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { Collection, installTypePack } from "@callumalpass/mdbase";
import { chromium, expect } from "@playwright/test";
import { parse } from "yaml";

process.env.NODE_ENV = "test";

const appRoot = resolve(import.meta.dirname, "..");
const connectRoot = resolve(
  process.env.TASKNOTES_CONNECT_ROOT ?? resolve(appRoot, "../mdbase-connect"),
);
const execute = promisify(execFile);
if (process.env.MDBASE_CONNECT_E2E_BUILD !== "0") {
  await execute("pnpm", ["build"], { cwd: connectRoot });
}
const { startConnectTestEnvironment } = await import(
  `${connectRoot}/scripts/lib/connect-test-environment.mjs`
);
const { hostedResources } = await import(
  `${connectRoot}/services/server/dist/hosted.js`
);
const { MemoryAuthority, MemoryReplicaStore, OfflineReplica, SyncError } =
  await import(`${connectRoot}/packages/sync/dist/index.js`);

const appPort = await availablePort();
const appUrl = `http://127.0.0.1:${appPort}`;
const provider = await startMemoryProvider();
let control;
let controlUrl;
let vite;
let browser;

try {
  control = await startConnectTestEnvironment({
    allowLocalApps: true,
    hostedProvider: {
      url: provider.dockerUrl,
      publicUrl: provider.url,
      internalToken: provider.internalToken,
    },
  });
  controlUrl = control.serverUrl;
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

  phase("creating a browser-local collection");
  await page.goto(appUrl);
  await page.getByRole("button", { name: /On this device/i }).click();
  await page.getByRole("button", { name: "Use this browser" }).click();
  await page.getByLabel("New task title").fill("Local foundation");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText("Local foundation", { exact: true }),
  ).toBeVisible();

  phase("moving the local collection into newly created hosted storage");
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Change collection" }).click();
  const collectionPicker = page.getByRole("dialog", { name: "Collections" });
  await expect(collectionPicker).toBeVisible();
  await collectionPicker
    .getByRole("button", { name: /Move this collection to mdbase/ })
    .click();
  let dropActivationResponse = true;
  await context.route("**/v1/authority-adoptions/*/complete", async (route) => {
    if (!dropActivationResponse || route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    dropActivationResponse = false;
    await route.abort("failed");
  });
  const approvalPagePromise = context.waitForEvent("page");
  await page.getByRole("button", { name: "Continue with mdbase" }).click();
  const approvalPage = await approvalPagePromise;
  await approvalPage.waitForLoadState();
  await expect(approvalPage).toHaveURL(
    new RegExp(`^${escapeRegex(controlUrl)}/login`),
  );
  await approvalPage.getByLabel("Name").fill("TaskNotes E2E");
  await approvalPage.getByLabel("Email").fill("tasknotes-e2e@example.com");
  await approvalPage.getByRole("button", { name: "Continue" }).click();
  const approveTransfer = approvalPage.getByRole("button", {
    name: /Adopt this collection|Move this collection/,
  });
  await expect(approveTransfer).toBeVisible();
  await approveTransfer.click();
  await expect(
    page.getByRole("heading", {
      name: "Authority activation must be resolved.",
    }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("button", { name: "Back to collection details" }),
  ).toHaveCount(0);
  phase("restarting TaskNotes while authority activation is unresolved");
  await page.reload();
  await expect(page).toHaveURL(
    new RegExp(`^${escapeRegex(controlUrl)}/authorize`),
    { timeout: 15_000 },
  );
  await expect(
    page.getByRole("radio", { name: /TaskNotes Hosted by mdbase/ }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Allow TaskNotes" }).click();
  await expect(page).toHaveURL(
    new RegExp(`^${escapeRegex(appUrl)}(?:/more)?\\?collection=`),
    {
      timeout: 15_000,
    },
  );
  await expect
    .poll(() => new URL(page.url()).searchParams.get("collection"))
    .toMatch(/^[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { name: "TaskNotes is hosted." }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText(/1 record and 1 saved view adopted/),
  ).toBeVisible();
  const transferredViews = provider.transferredViewSources();
  assert.equal(transferredViews.length, 1);
  assert.match(transferredViews[0].document, /name: Today/);
  await page.getByRole("button", { name: "Open hosted collection" }).click();
  if (
    await page
      .getByRole("heading", { name: "TaskNotes could not open." })
      .isVisible()
      .catch(() => false)
  ) {
    await page.getByText("Technical details", { exact: true }).click();
    throw new Error(
      `TaskNotes failed to open the hosted collection:\n${await page.locator("main").innerText()}`,
    );
  }
  await page.getByRole("button", { name: "Cloud board" }).click();
  await expect(page.getByRole("heading", { name: "Cloud board" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByText("Local foundation", { exact: true }),
  ).toBeVisible();
  const hosted = provider.onlyCollection();
  const migratedRecord = hosted.authority
    .serialize()
    .records.find((record) => record.frontmatter.title === "Local foundation");
  assert.ok(
    migratedRecord,
    "The local record was not copied to hosted storage",
  );

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
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText("Up to date", { exact: true })).toBeVisible();

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
  await expect(
    page.getByRole("button", { name: "Cloud foundation Urgency" }),
  ).toBeVisible();
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
  await expect
    .poll(
      () => markdownFrontmatter(provider.viewSource().document).views[0].select,
    )
    .toEqual(["status", "urgency", "due"]);
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
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByText(/1 change waiting to upload/)).toBeVisible();
  await expect(page.getByText("Offline · changes saved here")).toBeVisible();
  provider.setOnline(true);
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText("Up to date", { exact: true })).toBeVisible();
  assert.equal(
    hosted.authority
      .serialize()
      .records.find((record) => record.record_id === cloudRecord.record_id)
      ?.frontmatter.title,
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
  await page.getByRole("button", { name: "More", exact: true }).click();
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
  await page.getByRole("button", { name: "More", exact: true }).click();
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
  await control?.close().catch(() => undefined);
  await provider.close();
}

async function startMemoryProvider() {
  const collections = new Map();
  const replicas = new Map();
  const tokens = new Map();
  const authorityImports = new Map();
  const timerReconciliations = [];
  const internalToken = `tasknotes-e2e-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  let online = true;
  let client;
  const server = createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader(
      "access-control-allow-headers",
      "authorization,content-type",
    );
    response.setHeader(
      "access-control-allow-methods",
      "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    );
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
      if (url.pathname === "/ready") {
        send(response, 200, { ready: true });
        return;
      }
      if (url.pathname.startsWith("/internal/")) {
        await handleInternalRequest(request, response, url);
        return;
      }
      const authorityImport = url.pathname.match(
        /^\/v1\/authority-imports\/([^/]+)\/(manifest|records|finalize)$/,
      );
      if (authorityImport) {
        await handleAuthorityImportRequest(
          request,
          response,
          authorityImport[1],
          authorityImport[2],
        );
        return;
      }
      const match = url.pathname.match(
        /^\/v1\/authorities\/([^/]+)\/sync\/(sessions|snapshot|changes|mutations)$/,
      );
      const operationMatch = url.pathname.match(
        /^\/v1\/authorities\/([^/]+)\/operations\/(list_views|execute_view|read_view_source|create_view_source|update_view_source|delete_view_source|reconcile_timers)$/,
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
        const operationRequest = await requestJson(request);
        assert.equal(operationRequest.protocol_version, 1);
        assert.match(operationRequest.request_id, /^[0-9a-f-]{36}$/);
        const input = operationRequest.input;
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
          sendOperation(response, operationRequest, {
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
          });
        } else if (operation === "list_views") {
          sendOperation(
            response,
            operationRequest,
            cloudViewList(viewSource, [...transferredViews.values()]),
          );
        } else if (operation === "execute_view") {
          sendOperation(
            response,
            operationRequest,
            cloudViewExecution(authority.serialize().records),
          );
        } else if (operation === "read_view_source") {
          const source =
            input.path === viewSource.path
              ? viewSource
              : transferredViews.get(input.path);
          if (!source)
            throw new SyncError("view_not_found", "View source not found.");
          sendOperation(response, operationRequest, valid(source));
        } else if (operation === "create_view_source") {
          if (
            input.path === viewSource.path ||
            transferredViews.has(input.path)
          )
            throw new SyncError(
              "already_exists",
              "The test view already exists.",
            );
          const source = {
            path: input.path,
            format: input.format,
            revision: `transferred-view-${++viewRevision}`,
            document: input.document,
          };
          transferredViews.set(source.path, source);
          sendOperation(response, operationRequest, valid(source));
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
          sendOperation(response, operationRequest, valid(viewSource));
        } else {
          if (input.path !== viewSource.path)
            throw new SyncError("view_not_found", "View source not found.");
          if (input.if_revision !== viewSource.revision)
            throw new SyncError("revision_conflict", "Revision conflict.");
          sendOperation(
            response,
            operationRequest,
            valid({ path: viewSource.path, deleted: true }),
          );
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
      console.error(
        `Memory provider request failed: ${request.method} ${request.url}`,
        reason,
      );
      const code = reason instanceof SyncError ? reason.code : "provider_error";
      send(
        response,
        400,
        error(code, reason instanceof Error ? reason.message : String(reason)),
      );
    }
  });
  await new Promise((resolveListen) =>
    server.listen(0, "0.0.0.0", resolveListen),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Provider did not start");
  const url = `http://127.0.0.1:${address.port}`;
  let viewRevision = 1;
  let viewSource = cloudViewSource();
  const transferredViews = new Map();

  function removeReplicaTokens(replicaId) {
    for (const [token, value] of tokens)
      if (value.replicaId === replicaId) tokens.delete(token);
  }

  async function handleInternalRequest(request, response, requestUrl) {
    const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (bearer !== internalToken) {
      send(response, 401, error("invalid_internal_token", "Invalid token."));
      return;
    }
    const method = request.method ?? "GET";
    const collection = requestUrl.pathname.match(
      /^\/internal\/v1\/collections\/([^/]+)$/,
    );
    const provision = requestUrl.pathname.match(
      /^\/internal\/v1\/collections\/([^/]+)\/type-packs\/provision$/,
    );
    const collectionReplicas = requestUrl.pathname.match(
      /^\/internal\/v1\/collections\/([^/]+)\/replicas$/,
    );
    const replicaToken = requestUrl.pathname.match(
      /^\/internal\/v1\/replicas\/([^/]+)\/token$/,
    );
    const replicaPolicy = requestUrl.pathname.match(
      /^\/internal\/v1\/replicas\/([^/]+)\/policy$/,
    );
    const replica = requestUrl.pathname.match(
      /^\/internal\/v1\/replicas\/([^/]+)$/,
    );
    const notificationGrant = requestUrl.pathname.match(
      /^\/internal\/v1\/collections\/([^/]+)\/notification-grants\/([^/]+)$/,
    );
    const compact = requestUrl.pathname.match(
      /^\/internal\/v1\/collections\/([^/]+)\/compact$/,
    );
    const authorityImport = requestUrl.pathname.match(
      /^\/internal\/v1\/authority-imports(?:\/([^/]+))?$/,
    );

    if (authorityImport && method === "POST" && !authorityImport[1]) {
      const input = await requestJson(request);
      const expiresAt = new Date(
        Date.now() + Number(input.ttl_seconds) * 1_000,
      ).toISOString();
      const existing = authorityImports.get(input.transfer_id);
      if (!existing) {
        authorityImports.set(input.transfer_id, {
          id: input.transfer_id,
          collectionId: input.collection_id,
          displayName: input.display_name,
          token: input.token,
          authorityEpoch: input.authority_epoch,
          expiresAt,
          state: "receiving",
          manifest: null,
          pages: new Map(),
          contracts: [],
        });
      } else {
        existing.token = input.token;
        existing.expiresAt = expiresAt;
      }
      send(
        response,
        200,
        authorityImportView(authorityImports.get(input.transfer_id)),
      );
    } else if (authorityImport?.[1] && method === "POST") {
      const input = await requestJson(request);
      const imported = authorityImports.get(authorityImport[1]);
      if (
        !imported ||
        !["uploaded", "completed"].includes(imported.state) ||
        imported.manifest.manifest_digest !== input.manifest_digest ||
        imported.manifest.source_revision !== input.source_revision
      )
        throw new SyncError(
          "authority_import_not_ready",
          "Import is not ready.",
        );
      imported.state = "completed";
      send(response, 200, authorityImportView(imported));
    } else if (authorityImport?.[1] && method === "DELETE") {
      const imported = authorityImports.get(authorityImport[1]);
      if (!imported)
        throw new SyncError("authority_import_not_found", "Import not found.");
      imported.state = "aborted";
      collections.delete(imported.collectionId);
      send(response, 200, authorityImportView(imported));
    } else if (
      method === "POST" &&
      requestUrl.pathname === "/internal/v1/collections"
    ) {
      const input = await requestJson(request);
      await client.createCollection(
        input.collection_id,
        input.template,
        input.display_name,
      );
      sendEmpty(response);
    } else if (collection && method === "PATCH") {
      const input = await requestJson(request);
      await client.renameCollection(collection[1], input.display_name);
      sendEmpty(response);
    } else if (collection && method === "DELETE") {
      await client.deleteCollection(collection[1]);
      sendEmpty(response);
    } else if (provision && method === "POST") {
      const input = await requestJson(request);
      const contracts = await client.provisionTypePacks(
        provision[1],
        input.type_packs,
      );
      send(response, 200, { contracts });
    } else if (collectionReplicas && method === "POST") {
      const input = await requestJson(request);
      await client.registerReplica(collectionReplicas[1], {
        id: input.replica_id,
        name: input.name,
        purpose: input.purpose,
        mode: input.mode,
        allowedTypes: input.allowed_types,
        fullCollection: input.full_collection,
        allowedOperations: input.allowed_operations,
        allowedOrigin: input.allowed_origin,
        proofPublicKey: input.proof_public_key,
        grantId: input.grant_id,
        token: input.token,
        tokenTtlSeconds: input.token_ttl_seconds,
      });
      sendEmpty(response);
    } else if (collectionReplicas && method === "GET") {
      send(response, 200, {
        replicas: await client.replicaStatuses(collectionReplicas[1]),
      });
    } else if (replicaToken && method === "POST") {
      const input = await requestJson(request);
      await client.rotateReplicaToken(
        replicaToken[1],
        input.token,
        input.token_ttl_seconds,
      );
      sendEmpty(response);
    } else if (replicaPolicy && method === "PATCH") {
      const input = await requestJson(request);
      await client.updateApplicationReplica(replicaPolicy[1], {
        grantId: input.grant_id,
        mode: input.mode,
        allowedTypes: input.allowed_types,
        fullCollection: input.full_collection,
        allowedOperations: input.allowed_operations,
      });
      sendEmpty(response);
    } else if (replica && method === "DELETE") {
      await client.revokeReplica(replica[1]);
      sendEmpty(response);
    } else if (notificationGrant && method === "PUT") {
      await client.upsertNotificationGrant(
        notificationGrant[1],
        await requestJson(request),
      );
      sendEmpty(response);
    } else if (notificationGrant && method === "DELETE") {
      await client.revokeNotificationGrant(
        notificationGrant[1],
        notificationGrant[2],
      );
      sendEmpty(response);
    } else if (compact && method === "POST") {
      const input = await requestJson(request);
      await client.compactThrough(compact[1], input.through);
      sendEmpty(response);
    } else {
      send(response, 404, error("not_found", "Not found."));
    }
  }

  async function handleAuthorityImportRequest(
    request,
    response,
    importId,
    operation,
  ) {
    const imported = authorityImports.get(importId);
    const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!imported || bearer !== imported.token) {
      send(
        response,
        401,
        error("invalid_authority_import_token", "Invalid token."),
      );
      return;
    }
    if (operation === "manifest" && request.method === "PUT") {
      imported.manifest = await requestJson(request);
      imported.pages.clear();
      imported.state = "receiving";
      send(response, 200, authorityImportView(imported));
      return;
    }
    if (operation === "records" && request.method === "PUT") {
      if (imported.state !== "receiving" || !imported.manifest)
        throw new SyncError(
          "authority_import_inactive",
          "Import is not receiving records.",
        );
      const page = await requestJson(request);
      imported.pages.set(page.page, page.records);
      send(response, 200, authorityImportView(imported));
      return;
    }
    if (operation === "finalize" && request.method === "POST") {
      const records = [...imported.pages.entries()]
        .sort(([left], [right]) => left - right)
        .flatMap(([, page]) => page);
      if (records.length !== imported.manifest.record_count)
        throw new SyncError(
          "authority_import_incomplete",
          "Import is incomplete.",
        );
      const resources = await importedResources(imported.manifest.resources);
      const authority = new MemoryAuthority({
        id: imported.collectionId,
        resources,
      });
      authority.seed(
        records.map((record) => {
          const parsed = markdownDocument(record.document);
          return {
            record_id: record.record_id,
            path: record.path,
            frontmatter: parsed.frontmatter,
            body: parsed.body,
            types: explicitTypes(parsed.frontmatter),
          };
        }),
      );
      collections.set(imported.collectionId, {
        displayName: imported.displayName,
        authority,
      });
      for (const document of resources.documents.filter(
        ({ kind }) => kind === "view",
      )) {
        transferredViews.set(document.path, {
          path: document.path,
          format: "obsidian.base",
          revision: document.revision,
          document: document.document,
        });
      }
      imported.contracts = resources.contracts;
      imported.state = "uploaded";
      send(response, 200, authorityImportView(imported));
      return;
    }
    send(response, 404, error("not_found", "Not found."));
  }

  client = {
    url,
    ready: async () => undefined,
    createCollection: async (collectionId, template, displayName) => {
      collections.set(collectionId, {
        displayName,
        authority: new MemoryAuthority({
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
    provisionTypePacks: async (collectionId, provisions) => {
      const collection = collections.get(collectionId);
      if (!collection) throw new Error("Collection not found");
      const resources = await provisionedResources(
        collection.authority.serialize().resources,
        provisions,
      );
      const previous = collection.authority;
      collection.authority = MemoryAuthority.restore(
        {
          ...previous.serialize(),
          resources,
        },
        {
          id: collectionId,
          resources,
        },
        previous,
      );
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
      Object.assign(replica, {
        grantId: policy.grantId,
        mode: policy.mode,
        allowedTypes: policy.allowedTypes,
        fullCollection: policy.fullCollection,
        allowedOperations: policy.allowedOperations,
      });
      collections
        .get(replica.collectionId)
        .authority.updateReplicaScope(replicaId, policy.allowedTypes);
      for (const enrollment of tokens.values()) {
        if (enrollment.replicaId === replicaId) {
          enrollment.allowedOperations = policy.allowedOperations;
        }
      }
    },
    revokeReplica: async (replicaId) => {
      const replica = replicas.get(replicaId);
      if (replica) {
        collections
          .get(replica.collectionId)
          .authority.revokeReplica(replicaId);
        replica.revoked = true;
      }
      removeReplicaTokens(replicaId);
    },
    replicaStatuses: async (collectionId) => {
      const collection = collections.get(collectionId);
      const head = collection?.authority.serialize().head ?? 0;
      return [...replicas.values()]
        .filter(
          (replica) =>
            replica.collectionId === collectionId && !replica.revoked,
        )
        .map((replica) => ({
          id: replica.id,
          head,
          acknowledged_sequence: head,
          last_seen_at: new Date().toISOString(),
          token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }));
    },
    compactThrough: async (collectionId, sequence) => {
      collections.get(collectionId).authority.compactThrough(sequence);
    },
    upsertNotificationGrant: async () => undefined,
    revokeNotificationGrant: async () => undefined,
  };

  return {
    client,
    url,
    dockerUrl: `http://host.docker.internal:${address.port}`,
    internalToken,
    setOnline(value) {
      online = value;
    },
    viewSource() {
      return structuredClone(viewSource);
    },
    transferredViewSources() {
      return structuredClone([...transferredViews.values()]);
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

async function provisionedResources(resources, provisions) {
  const root = await mkdtemp(join(tmpdir(), "tasknotes-type-packs-"));
  try {
    await writeFile(
      join(root, "mdbase.yaml"),
      "spec_version: 0.3.0\nsettings:\n  validation: error\n",
    );
    const documents = new Map(
      (resources?.documents ?? [])
        .filter(({ kind }) => ["contract", "schema", "type"].includes(kind))
        .map((document) => [document.path, document]),
    );
    for (const document of documents.values()) {
      const target = join(root, document.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, document.document);
    }
    for (const provision of provisions) {
      const installed = await installTypePack(
        root,
        provision.manifest,
        provision.resources,
      );
      if (!installed.valid) {
        throw new Error(
          installed.diagnostics
            .map((diagnostic) => diagnostic.message)
            .join("; "),
        );
      }
      const sources = new Map(
        provision.resources.map((resource) => [
          resource.source,
          resource.document,
        ]),
      );
      for (const resource of provision.manifest.resources) {
        documents.set(resource.target, {
          path: resource.target,
          kind: resource.kind,
          revision: resource.digest,
          document: sources.get(resource.source),
        });
      }
    }

    const opened = await Collection.open(root);
    if (!opened.collection || opened.error) {
      throw new Error(
        opened.error?.message ?? "Provisioned collection did not open.",
      );
    }
    try {
      const types = [...documents.values()]
        .filter(({ kind }) => kind === "type")
        .map(({ document }) => {
          const definition = markdownFrontmatter(document);
          return {
            name: definition.name,
            version: definition.version ?? 1,
            schema: definition.schema?.value ?? {},
            collection: definition.collection,
            definition,
            extensions: Object.fromEntries(
              Object.entries(definition).filter(
                ([key, value]) =>
                  key.startsWith("x-") &&
                  value !== null &&
                  typeof value === "object" &&
                  !Array.isArray(value),
              ),
            ),
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name));
      const contracts = opened.collection
        .listDataContracts()
        .filter(
          (contract) =>
            contract.contract_type === "record" && contract.record_schema,
        )
        .map((contract) => ({
          contract_type: "record",
          id: contract.id,
          version: contract.version,
          digest: contract.digest,
          schema: contract.record_schema.value,
          ...(contract.binding_schema
            ? { binding_schema: contract.binding_schema.value }
            : {}),
          implementations: opened.collection
            .getDataContractImplementations(contract.id, contract.version)
            .map((implementation) => ({
              type_name: implementation.type,
              type_version: implementation.type_version,
              ...(implementation.source_path
                ? { type_path: implementation.source_path }
                : {}),
              digest: implementation.implementation_digest,
              fields: implementation.fields,
              ...(implementation.binding
                ? { binding: implementation.binding }
                : {}),
            })),
        }));
      return {
        revision: crypto.randomUUID(),
        spec_version: resources?.spec_version ?? "0.3.0",
        types,
        contracts,
        documents: [
          ...(resources?.documents ?? []).filter(
            ({ kind }) => !["contract", "schema", "type"].includes(kind),
          ),
          ...documents.values(),
        ],
      };
    } finally {
      await opened.collection.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function authorityImportView(imported) {
  return {
    id: imported.id,
    collection_id: imported.collectionId,
    authority_epoch: imported.authorityEpoch,
    state: imported.state,
    manifest_digest: imported.manifest?.manifest_digest ?? null,
    source_revision: imported.manifest?.source_revision ?? null,
    source_head: imported.manifest?.source_head ?? null,
    contracts: imported.contracts,
    expires_at: imported.expiresAt,
  };
}

function importedResources(resources) {
  return provisionedResources(resources, []);
}

function markdownDocument(document) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(document);
  if (!match) return { frontmatter: {}, body: document };
  return {
    frontmatter: parse(match[1]) ?? {},
    body: document.slice(match[0].length),
  };
}

function explicitTypes(frontmatter) {
  return [
    ...(typeof frontmatter.type === "string" ? [frontmatter.type] : []),
    ...(Array.isArray(frontmatter.types)
      ? frontmatter.types.filter((value) => typeof value === "string")
      : []),
  ];
}

function cloudViewList(source, transferred = []) {
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
        ...transferred.map((candidate) => ({
          id: candidate.path,
          name: candidate.path,
          source: {
            path: candidate.path,
            format: candidate.format,
            revision: candidate.revision,
            writable: true,
          },
          views: [],
        })),
      ],
      meta: { total_count: 1 + transferred.length },
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
        effective_frontmatter: record.frontmatter,
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

function sendOperation(response, request, result) {
  send(response, 200, {
    protocol_version: 1,
    request_id: request.request_id,
    ok: true,
    result,
  });
}

function sendEmpty(response) {
  response.writeHead(204).end();
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
