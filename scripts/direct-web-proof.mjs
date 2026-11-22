import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { build } from "vite";
import { seedDirectFixture } from "./direct-fixture.mjs";
import { previewDirect } from "./preview-self-hosted.mjs";

assert(
  process.argv.length === 4,
  "Expected: direct-web-proof.mjs <mdbase binary> <self-hosted web dist>",
);
const binary = resolve(process.argv[2]);
const outDir = resolve(process.argv[3]);
const root = await mkdtemp(join(tmpdir(), "tasknotes-direct-"));
const folder = join(root, "collection");
const markdown = join(folder, "tasks/proof.md");
const contexts = new Set();
const secretValues = new Set();
const staticHeaders = [];
const violations = new Set();
let server, daemon, exited;
let stage = "fixture and preview startup";

function operatorArgs() {
  return [
    "self-host",
    "--state-dir",
    join(root, "profile"),
    "--collection",
    folder,
    "--origin",
    server.origin,
    "--auth-dir",
    join(root, "auth"),
  ];
}

function operator(...args) {
  return execFileSync(binary, [...operatorArgs(), ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10000,
  }).trim();
}

function issueCode(label) {
  const code = operator("pair", label);
  assert(/^\d{8}$/.test(code), "Expected an eight-digit operator code");
  secretValues.add(code);
  return code;
}

async function startDaemon() {
  daemon = spawn(
    binary,
    [...operatorArgs(), "serve", "--listen", server.listen],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  exited = once(daemon, "exit");
  const ready = await Promise.race([
    once(daemon.stdout, "data", { signal: AbortSignal.timeout(15000) }),
    exited.then(() => {
      throw Error("Daemon did not start");
    }),
  ]);
  assert(ready[0].toString().includes(`listening ${server.listen}`));
}

async function stopDaemon() {
  if (!daemon?.pid || daemon.exitCode !== null || daemon.signalCode) return;
  daemon.kill("SIGTERM");
  await Promise.race([exited, delay(3000, null, { ref: false })]);
  if (daemon.exitCode === null && !daemon.signalCode) {
    daemon.kill("SIGKILL");
    await exited;
  }
}

async function openProfile(name) {
  const context = await chromium.launchPersistentContext(join(root, name), {
    args: server.chromiumArgs,
    locale: "en-US",
    timezoneId: "UTC",
  });
  contexts.add(context);
  context.on("close", () => contexts.delete(context));
  await context.exposeBinding("reportOutsideRequest", () =>
    violations.add("CSP blocked an external request"),
  );
  await context.addInitScript(() => {
    globalThis.addEventListener("securitypolicyviolation", ({ blockedURI }) => {
      if (
        /^https?:/.test(blockedURI) &&
        new URL(blockedURI).origin !== globalThis.location.origin
      )
        void globalThis.reportOutsideRequest();
    });
  });
  context.on("serviceworker", () => violations.add("direct service worker"));
  context.on("request", (request) => {
    if (new URL(request.url()).origin !== server.origin)
      violations.add("non-static HTTP request");
  });
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(15000);
  const wire = { pairs: 0, replicas: 0, token: null };
  page.on("websocket", (socket) => {
    const base = server.backend.replace("https:", "wss:");
    if (socket.url() === `${base}/_mdbase/pair`) {
      wire.pairs++;
      socket.on("framereceived", ({ payload }) => {
        if (typeof payload === "string" && /^[a-f0-9]{64}$/.test(payload)) {
          secretValues.add(payload);
          wire.token = payload;
        }
      });
    } else if (socket.url() === `${base}/_mdbase/replica`) wire.replicas++;
    else violations.add("unexpected browser socket");
  });
  const response = await page.goto(server.origin);
  const headers = await response.allHeaders();
  assert.match(
    headers["content-security-policy"],
    /^default-src 'none'; .*; frame-ancestors 'none'$/,
  );
  assert.equal(headers["cross-origin-opener-policy"], "same-origin");
  assert.equal(headers["referrer-policy"], "no-referrer");
  assert.equal(headers["cache-control"], "no-store");
  return { context, page, wire };
}

const codeField = (page) => page.getByLabel(/pairing code/i);
const ready = (page) =>
  expect(page.getByRole("button", { name: "Search", exact: true })).toBeVisible(
    { timeout: 20000 },
  );
async function pair(page, code, remember) {
  await page.getByLabel(/server address/i).fill(server.backend);
  await page.getByRole("checkbox", { name: /remember/i }).setChecked(remember);
  await codeField(page).fill(code);
  await codeField(page).press("Enter");
}

try {
  await seedDirectFixture(folder);
  const sdk = await build({
    configFile: false,
    logLevel: "error",
    publicDir: false,
    build: {
      write: false,
      lib: {
        entry: fileURLToPath(
          import.meta.resolve("@tasknotes/direct-sdk/direct"),
        ),
        formats: ["es"],
      },
    },
  });
  const module = (Array.isArray(sdk) ? sdk[0] : sdk).output.find(
    (item) => item.isEntry,
  );
  const staticPaths = new Set([
    "/",
    "/__proof-sdk.js",
    "/__proof-previous-worker.js",
    "/favicon.ico",
  ]);
  for (const entry of await readdir(outDir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isFile())
      staticPaths.add(
        "/" + relative(outDir, join(entry.parentPath, entry.name)),
      );
  }
  const css = await Promise.all(
    [...staticPaths]
      .filter((path) => path.endsWith(".css"))
      .map((path) => readFile(join(outDir, path), "utf8")),
  );
  assert(
    !css.some((text) =>
      /url\(["']?data:(?:font\/|application\/(?:x-font|font|vnd.ms-fontobject))/i.test(
        text,
      ),
    ),
    "A direct stylesheet embeds a font forbidden by CSP",
  );
  assert(
    [...staticPaths].some((path) =>
      /KaTeX_Size3-Regular-.+\.woff2$/.test(path),
    ),
    "Expected the emitted same-origin KaTeX font",
  );
  server = await previewDirect({
    outDir,
    root,
    sdkCode: module.code,
    observeStatic(request, upgrade) {
      staticHeaders.push(request.rawHeaders.join("\n"));
      if (!staticPaths.has(request.url))
        violations.add("non-asset static request target");
      if (upgrade) violations.add("static WebSocket upgrade");
      if (
        request.method !== "GET" ||
        request.headers.authorization ||
        request.headers.cookie ||
        request.headers["transfer-encoding"] ||
        Number(request.headers["content-length"] ?? 0) !== 0
      )
        violations.add("non-static request method, body or credentials");
      request.on("data", () => violations.add("static request body"));
    },
  });
  assert(
    !staticPaths.has("/service-worker.js") &&
      !staticPaths.has("/manifest.webmanifest"),
  );
  stage = "previous worker blocks pairing";
  const workerContext = await chromium.launchPersistentContext(
    join(root, "previous-worker"),
    {
      args: server.chromiumArgs,
    },
  );
  contexts.add(workerContext);
  const workerPage = await workerContext.newPage();
  await workerPage.route("**/__proof-install", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Previous worker</title>",
    }),
  );
  await workerPage.goto(`${server.origin}/__proof-install`);
  await workerPage.evaluate(async () => {
    await globalThis.caches.open("previous-shell");
    await navigator.serviceWorker.register("/__proof-previous-worker.js");
    await navigator.serviceWorker.ready;
  });
  workerPage.on("websocket", () =>
    violations.add("socket with a previous worker"),
  );
  await workerPage.goto(server.origin);
  await expect(workerPage.getByRole("alert")).toContainText(
    "without a service worker",
  );
  await expect(codeField(workerPage)).toHaveCount(0);
  assert(
    await workerPage.evaluate(
      async () =>
        (await globalThis.caches.has("previous-shell")) &&
        Boolean(navigator.serviceWorker.controller) &&
        (await navigator.serviceWorker.getRegistrations()).length === 1,
    ),
  );
  await workerContext.close();
  contexts.delete(workerContext);
  console.log(
    "PASS: a controlling worker blocks pairing and remains installed",
  );
  stage = "daemon startup";
  await startDaemon();
  stage = "pairing and incorrect code";
  let primary = await openProfile("primary");
  const { page } = primary;
  await expect(codeField(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
  const code = issueCode("Primary");
  const badCode = code === "00000000" ? "00000001" : "00000000";
  secretValues.add(badCode);
  await pair(page, badCode, true);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(codeField(page)).toHaveValue("");
  assert.equal(primary.wire.pairs, 1);
  assert.equal(operator("list"), "");
  await pair(page, code, true);
  await ready(page);
  const primaryEntry = operator("list");
  const [primaryId, label] = primaryEntry.split("\t");
  const primaryToken = primary.wire.token;
  assert(
    /^[a-f0-9]{32}$/.test(primaryId) && label === "Primary" && primaryToken,
  );
  console.log(
    "PASS: incorrect code rejected; valid code pairs over a real cross-origin WSS connection",
  );
  stage = "browser task editing";
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search tasks" }).fill("Loopback");
  const row = (title) => page.getByRole("button", { name: title, exact: true });
  await expect(row("Loopback original")).toBeVisible({ timeout: 20000 });
  await row("Loopback original").click();
  const route = new URL(page.url());
  assert.equal(route.pathname + route.search, "/");
  assert(route.hash.startsWith("#/task/"));
  const title = page.getByRole("textbox", { name: "Task title", exact: true });
  await title.fill("Edited in TaskNotes");
  await title.blur();
  await expect(page.locator(".save-state")).toHaveText("Saved", {
    timeout: 12000,
  });
  await expect
    .poll(() => readFile(markdown, "utf8"))
    .toContain("title: Edited in TaskNotes");
  console.log(
    "PASS: TaskNotes read a seeded task and saved a browser edit to Markdown",
  );

  const before = await readFile(markdown, "utf8");
  await writeFile(
    markdown,
    before.replace(
      "title: Edited in TaskNotes",
      "title: External Markdown edit",
    ),
  );
  await expect(title).toHaveValue("External Markdown edit", { timeout: 15000 });
  console.log(
    "PASS: live browser reflects external Markdown edit without reload",
  );

  stage = "attachment round trip";
  const section = page.getByRole("region", {
    name: "Attachments",
    exact: true,
  });
  const bytes = Buffer.alloc(1024 * 1024 + 7);
  for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251;
  await section.getByLabel("Attach file", { exact: true }).setInputFiles({
    name: "proof.bin",
    mimeType: "application/octet-stream",
    buffer: bytes,
  });
  const download = section.getByRole("button", {
    name: "Download proof.bin",
    exact: true,
  });
  await expect(download).toBeVisible({ timeout: 15000 });
  const [output] = await Promise.all([
    page.waitForEvent("download"),
    download.click(),
  ]);
  assert.equal(output.suggestedFilename(), "proof.bin");
  assert.deepEqual(await readFile(await output.path()), bytes);
  const files = await readdir(join(folder, "Attachments"));
  assert.equal(files.length, 1);
  assert.match(files[0], /-proof\.bin$/);
  assert.deepEqual(
    await readFile(join(folder, "Attachments", files[0])),
    bytes,
  );
  assert((await readFile(markdown, "utf8")).includes("proof.bin"));
  console.log(
    "PASS: UI upload, Markdown attachment membership and byte-for-byte download",
  );

  stage = "revision conflict";
  const conflict = await page.evaluate(
    async ({ server, token }) => {
      const { connectDirect } = await import("/__proof-sdk.js");
      const client = await connectDirect({
        server,
        token,
        app: { name: "cas-proof", version: "1" },
      });
      try {
        const ref = { path: "tasks/proof.md" };
        const original = await client.get(ref);
        const saved = await client.update(original, {
          patch: { title: "New revision" },
          ifRevision: original.revision,
        });
        await saved.confirmed;
        try {
          const stale = await client.update(original, {
            patch: { title: "Stale revision" },
            ifRevision: original.revision,
          });
          await stale.confirmed;
        } catch (error) {
          return [error.code, error.reason];
        }
        return null;
      } finally {
        client.close();
      }
    },
    { server: server.backend, token: primaryToken },
  );
  assert.deepEqual(conflict, ["conflict", "revision"]);
  await expect
    .poll(() => readFile(markdown, "utf8"))
    .toContain("title: New revision");
  console.log("PASS: stale CAS refused; winning edit remains on disk");

  stage = "remembered reload and browser restart";
  const pairsBefore = primary.wire.pairs;
  const replicasBefore = primary.wire.replicas;
  const devtools = await primary.context.newCDPSession(page);
  await devtools.send("Network.clearBrowserCache");
  await devtools.detach();
  await page.reload();
  await ready(page);
  assert(
    primary.wire.replicas > replicasBefore &&
      primary.wire.pairs === pairsBefore,
  );
  await primary.context.close();
  primary = await openProfile("primary");
  await ready(primary.page);
  assert(primary.wire.replicas > 0 && !primary.wire.pairs);
  console.log(
    "PASS: remembered login survives HTTP cache clearing, reload and reopening the same on-disk browser profile without pairing again",
  );

  stage = "replay and non-remembered login";
  const secondary = await openProfile("secondary");
  await pair(secondary.page, code, false);
  await expect(secondary.page.getByRole("alert")).toBeVisible();
  assert.equal(secondary.wire.pairs, 1);
  assert.equal(operator("list"), primaryEntry);
  await pair(secondary.page, issueCode("Ephemeral"), false);
  await ready(secondary.page);
  await search(secondary.page, "New revision");
  await secondary.page
    .getByRole("button", { name: "New revision", exact: true })
    .click();
  const privateDraft = "Tab-only task draft";
  secretValues.add(privateDraft);
  // An empty title keeps the task editor from submitting this draft on reload.
  const ephemeralTitle = secondary.page.getByRole("textbox", {
    name: "Task title",
    exact: true,
  });
  await ephemeralTitle.fill(privateDraft);
  assert(
    !(await secondary.page.evaluate(
      (value) => JSON.stringify(globalThis.localStorage).includes(value),
      privateDraft,
    )),
  );
  await ephemeralTitle.fill("");
  const ephemeralSockets = secondary.wire.replicas;
  const acceptReload = (dialog) => dialog.accept();
  secondary.page.on("dialog", acceptReload);
  try {
    await secondary.page.reload();
  } finally {
    secondary.page.off("dialog", acceptReload);
  }
  await expect(codeField(secondary.page)).toBeVisible();
  assert.equal(secondary.wire.replicas, ephemeralSockets);
  assert(
    !(await secondary.page.evaluate(() =>
      Object.keys(globalThis.localStorage).some((key) =>
        key.includes("direct:"),
      ),
    )),
    "A tab-only pairing left collection state in browser storage",
  );
  await pair(secondary.page, issueCode("Secondary"), true);
  await ready(secondary.page);
  assert(secondary.wire.token && secondary.wire.token !== primaryToken);
  console.log(
    "PASS: consumed code refused in another profile; non-remembered login lost on reload; new pairing issues a distinct credential",
  );

  stage = "live disconnect during a task draft and a pending delete";
  const live = primary.page;
  const draftText = "Keep this unsaved title — 草稿";
  secretValues.add(draftText);
  async function search(page, title) {
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search tasks" }).fill(title);
  }
  await search(live, "New revision");
  await live.getByRole("button", { name: "New revision", exact: true }).click();
  await search(secondary.page, "New revision");
  await secondary.page
    .getByRole("button", { name: "Task actions for New revision", exact: true })
    .click();
  await secondary.page
    .getByRole("menuitem", { name: "Delete", exact: true })
    .click();
  await secondary.page
    .getByRole("button", { name: "Delete task", exact: true })
    .click();
  await expect(secondary.page.locator(".undo-toast")).toContainText(
    "New revision",
  );
  await primary.context.grantPermissions(
    ["clipboard-read", "clipboard-write"],
    { origin: server.origin },
  );
  await live
    .getByRole("textbox", { name: "Task title", exact: true })
    .fill(draftText);
  await stopDaemon();
  await expect(live.getByRole("alert")).toContainText("Connection lost");
  await expect(secondary.page.getByRole("alert")).toContainText(
    "Deletions still in the Undo window were cancelled",
  );
  await expect(secondary.page.getByRole("alert")).not.toContainText(
    "may have reached",
  );
  await expect(
    live.getByRole("textbox", { name: "Unsaved task edits" }),
  ).toHaveValue(draftText);
  await live.getByRole("button", { name: "Copy unsaved edits" }).click();
  assert.equal(
    await live.evaluate(() => navigator.clipboard.readText()),
    draftText,
  );
  assert((await readFile(markdown, "utf8")).includes("title: New revision"));
  console.log(
    "PASS: live disconnect retained the exact unsaved title and copied it to the browser clipboard",
  );
  const retry = primary.page.getByRole("button", {
    name: /retry|reconnect|try again/i,
  });
  await expect(retry).toBeVisible({ timeout: 15000 });
  await expect(codeField(primary.page)).toHaveCount(0);
  await startDaemon();
  await retry.click();
  await ready(primary.page);
  assert.equal(primary.wire.pairs, 0);
  await expect(
    live.getByRole("button", { name: "Restore unsaved edits" }),
  ).toBeVisible();
  await expect(
    live.getByRole("textbox", { name: "Task title", exact: true }),
  ).toHaveValue("New revision");
  await live.getByRole("button", { name: "Discard recovered edits" }).click();
  await secondary.page.reload();
  await ready(secondary.page);
  await expect(secondary.page.locator(".undo-toast")).toHaveCount(0);
  assert((await readFile(markdown, "utf8")).includes("title: New revision"));
  console.log(
    "PASS: live Undo was cancelled and the draft was offered for explicit recovery",
  );
  console.log(
    "PASS: backend outage preserves remembered login; retry after daemon restart requires no new code",
  );

  stage = "independent revocation";
  await primary.page.exposeFunction("revokePrimary", () => {
    operator("revoke", primaryId);
  });
  const denied = await primary.page.evaluate(
    async ({ server, token }) => {
      const { connectDirect } = await import("/__proof-sdk.js");
      const client = await connectDirect({
        server,
        token,
        app: { name: "revocation-proof", version: "1" },
      });
      try {
        const ref = { path: "tasks/proof.md" };
        await client.get(ref);
        await globalThis.revokePrimary();
        try {
          await client.get(ref, { signal: AbortSignal.timeout(4000) });
        } catch (error) {
          return error.code;
        }
        return null;
      } finally {
        client.close();
      }
    },
    { server: server.backend, token: primaryToken },
  );
  assert(["unavailable", "unauthenticated"].includes(denied));
  await primary.page.reload();
  await expect(codeField(primary.page)).toBeVisible({ timeout: 15000 });
  const deniedSockets = primary.wire.replicas;
  await primary.page.reload();
  await expect(codeField(primary.page)).toBeVisible();
  assert.equal(primary.wire.replicas, deniedSockets);
  await secondary.page
    .getByRole("button", { name: "Search", exact: true })
    .click();
  await secondary.page
    .getByRole("searchbox", { name: "Search tasks" })
    .fill("New revision");
  await secondary.page
    .getByRole("button", { name: "New revision", exact: true })
    .click();
  const survivorTitle = secondary.page.getByRole("textbox", {
    name: "Task title",
    exact: true,
  });
  await survivorTitle.fill("Secondary still authorized");
  await survivorTitle.blur();
  await expect
    .poll(() => readFile(markdown, "utf8"))
    .toContain("title: Secondary still authorized");
  console.log(
    "PASS: revocation denies an already-connected client and clears its remembered grant; independent profile still reads and writes Markdown",
  );

  stage = "forget remembered browser";
  await stopDaemon();
  await secondary.page.reload();
  secondary.page.once("dialog", (dialog) => dialog.accept());
  await secondary.page.getByRole("button", { name: /forget/i }).click();
  await expect(codeField(secondary.page)).toBeVisible();
  const forgottenSockets = secondary.wire.replicas;
  await startDaemon();
  await secondary.page.reload();
  await expect(codeField(secondary.page)).toBeVisible();
  assert.equal(secondary.wire.replicas, forgottenSockets);
  console.log(
    "PASS: forgetting works even offline and prevents reconnect on reload",
  );

  stage = "static-origin network audit";
  assert(staticHeaders.length > 0);
  const sensitive = [
    ...secretValues,
    "tasks/proof.md",
    "tasks%2fproof.md",
    "proof.bin",
    "Loopback original",
    "Edited in TaskNotes",
    "External Markdown edit",
    "Synthetic fixture body",
    "New revision",
    "Secondary still authorized",
  ];
  if (
    staticHeaders.some((headers) =>
      sensitive.some(
        (value) =>
          headers.toLowerCase().includes(value.toLowerCase()) ||
          headers.includes(encodeURIComponent(value)),
      ),
    )
  )
    violations.add("sensitive value in static request headers");
  assert(!violations.size, [...violations].join("; "));
  console.log(
    "PASS: static origin received only asset GETs, no credentials, note data, request bodies or WebSocket upgrades; no outside application requests observed",
  );
} catch (error) {
  const location = error.stack
    ?.split("\n")
    .find((line) => /at .*direct-web-proof\.mjs:\d+/.test(line))
    ?.match(/direct-web-proof\.mjs:\d+/)?.[0];
  console.error(
    `Direct proof failed: ${stage}${location ? ` (${location})` : ""}${violations.size ? `; ${[...violations].join("; ")}` : ""}`,
  );
  process.exitCode = 1;
} finally {
  await Promise.all([...contexts].map((context) => context.close()));
  await stopDaemon();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
