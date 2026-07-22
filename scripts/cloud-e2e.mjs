import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { chromium, expect } from "@playwright/test";

process.env.NODE_ENV = "test";

const appRoot = resolve(import.meta.dirname, "..");
const connectRoot = resolve(appRoot, "../mdbase-connect");
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
  await page.getByRole("button", { name: /mdbase cloud/ }).click();
  await page.getByRole("button", { name: "Continue to mdbase" }).click();
  await expect(page).toHaveURL(new RegExp(`^${escapeRegex(controlUrl)}/login`));
  await page.getByLabel("Name").fill("TaskNotes E2E");
  await page.getByLabel("Email").fill("tasknotes-e2e@example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("button", { name: "Create an mdbase cloud collection" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create an mdbase cloud collection" })
    .click();
  await expect(page.getByLabel("Collection")).toContainText("My tasks");
  await page.getByRole("button", { name: "Allow access" }).click();
  await expect(page).toHaveURL(new RegExp(`^${escapeRegex(appUrl)}/?$`), {
    timeout: 15_000,
  });
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByText("Cloud · up to date")).toBeVisible();

  phase("creating a task locally and synchronizing it to the authority");
  await page.getByLabel("New task title").fill("Cloud foundation");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText("Cloud foundation", { exact: true }),
  ).toBeVisible();
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

  phase("saving immediately while the provider is offline, then resuming sync");
  provider.setOnline(false);
  await page.getByRole("button", { name: "Today" }).click();
  await page.getByText("Cloud foundation", { exact: true }).click();
  await page.getByLabel("Task title").fill("Cloud foundation offline");
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
  provider.setOnline(false);
  await page.getByRole("button", { name: "Today" }).click();
  await page.getByText("Cloud foundation offline", { exact: true }).click();
  await page.getByLabel("Task title").fill("Phone version");
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
  await page.getByRole("button", { name: "Today" }).click();
  await expect(page.getByText("Phone version", { exact: true })).toBeVisible();
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
  await control.close().catch(() => undefined);
  await database.end().catch(() => undefined);
  await provider.close();
}

async function startMemoryProvider() {
  const collections = new Map();
  const replicas = new Map();
  const tokens = new Map();
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
      const match = new URL(
        request.url ?? "/",
        "http://provider",
      ).pathname.match(
        /^\/v1\/hosted\/collections\/([^/]+)\/sync\/(sessions|snapshot|changes|mutations)$/,
      );
      if (!match) {
        send(response, 404, error("not_found", "Not found."));
        return;
      }
      const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const enrollment = bearer ? tokens.get(bearer) : undefined;
      if (!enrollment || enrollment.collectionId !== match[1]) {
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
      const authority = collections.get(match[1])?.authority;
      if (!authority)
        throw new SyncError("collection_not_found", "Collection not found.");
      const transport = authority.transport(enrollment.replicaId);
      const url = new URL(request.url ?? "/", "http://provider");
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
      provisionTypes: async () => {
        throw new Error(
          "The memory provider cannot provision additional types.",
        );
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
    },
    setOnline(value) {
      online = value;
    },
    onlyCollection() {
      assert.equal(collections.size, 1, "Expected one hosted collection");
      return collections.values().next().value;
    },
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
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
