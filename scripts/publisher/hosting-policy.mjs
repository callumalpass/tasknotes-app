// Source-owned Pages STATIC policy, never an artifact-provided auth/control flag.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyServedBytes } from "../lib/native-publish-bytes.mjs";
import { assertTrustedHeaders } from "../lib/native-publish-hosting.mjs";
export const headersPolicy =
  "/*\n  Strict-Transport-Security: max-age=31536000; includeSubDomains\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n  Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=(), usb=()\n\n/.well-known/mdbase-app.json\n  Cache-Control: no-store\n\n/service-worker.js\n  Cache-Control: no-cache\n\n/offline-assets.json\n  Cache-Control: no-cache\n\n/manifest.webmanifest\n  Cache-Control: no-cache\n\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n";
export const redirectsPolicy =
  "/auth/mdbase/callback / 200\n/auth/mdbase/callback/ / 200\n/more / 200\n/more/* / 200\n/scratchpad / 200\n/scratchpad/ / 200\n/search / 200\n/search/ / 200\n/task/* / 200\n/views / 200\n/views/* / 200\n";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const controlNames = new Set(["_headers", "_redirects", "_routes.json"]);
const isControl = (path) => controlNames.has(path.split("/").at(-1));
function assertPolicyInventory(inventory) {
  const expected = { _headers: headersPolicy, _redirects: redirectsPolicy };
  for (const name of Object.keys(expected)) {
    const bytes = Buffer.from(expected[name]),
      item = inventory.find((a) => a.path === name);
    if (item?.sha256 !== hash(bytes) || item.bytes !== bytes.length)
      throw Error("Unreviewed hosting control " + name);
  }
  for (const item of inventory) {
    if (
      (isControl(item.path) && !Object.hasOwn(expected, item.path)) ||
      item.path === "_worker.js" ||
      item.path.startsWith("_worker.js/") ||
      item.path.startsWith("functions/")
    )
      throw Error(
        "Unreviewed executing Pages Worker/route/control " + item.path,
      );
  }
  return expected;
}
export async function assertHostingSource(root, inventory) {
  for (const [name, bytes] of Object.entries(assertPolicyInventory(inventory)))
    if ((await readFile(join(root, name), "utf8")) !== bytes)
      throw Error("Source policy bytes changed " + name);
}
function checkHeaders(response, path) {
  // Pages canonical HTML redirects are validated by the shared helper. Header
  // policy applies to the final static response, not CDN-generated redirects.
  if ([301, 302, 303, 307, 308].includes(response.status)) return;
  assertTrustedHeaders(response, path);
  if (response.status !== 200) return;
  const type = response.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  if (path.endsWith(".wasm") && type !== "application/wasm")
    throw Error("Live WASM MIME policy mismatch");
  if (
    /\.(m?js)$/.test(path) &&
    !["text/javascript", "application/javascript"].includes(type)
  )
    throw Error("Live JS MIME policy mismatch");
  if (path.endsWith(".json") && type !== "application/json")
    throw Error("Live JSON MIME policy mismatch");
}
export async function verifyHosting({
  origin,
  inventory,
  deployment,
  fetchImpl = fetch,
  totalTimeoutMs = 180000,
  ...options
}) {
  if (
    ![
      "https://staging.tasknotes-app.pages.dev",
      "https://app.tasknotes.dev",
    ].includes(origin) &&
    !(
      origin === deployment?.url &&
      /^https:\/\/[a-f0-9]{8,32}\.tasknotes-app\.pages\.dev$/.test(origin)
    )
  )
    throw Error("Nonapproved verification origin");
  if (
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(deployment?.id ?? "")
  )
    throw Error("Actual deployment UUID required BEFORE served checks");
  assertPolicyInventory(inventory);
  const duration = Math.min(totalTimeoutMs, 180000);
  if (!Number.isFinite(duration) || duration <= 0)
    throw Error("Invalid verification deadline");
  const deadline = performance.now() + duration;
  const remaining = () => Math.max(0, Math.floor(deadline - performance.now()));
  const failures = [],
    probes = [];
  const transport = async (url, init) => {
    const response = await fetchImpl(url, init);
    try {
      checkHeaders(response, new URL(url).pathname);
    } catch (error) {
      try {
        Promise.resolve(response.body?.cancel()).catch(() => {});
      } catch {
        /* Preserve the original bounded policy refusal. */
      }
      throw error;
    }
    return response;
  };
  const probe = async (path, status, item) => {
    let timer,
      reader,
      controller = new AbortController();
    const timeout = Math.min(15000, remaining());
    if (timeout <= 0) throw Error("publication-timeout");
    try {
      return await Promise.race([
        (async () => {
          const url = origin + path;
          const response = await transport(url, {
            method: "GET",
            redirect: "manual",
            credentials: "omit",
            cache: "no-store",
            headers: { "Accept-Encoding": "identity" },
            signal: controller.signal,
          });
          if (
            response.redirected ||
            (response.url && response.url !== url) ||
            response.status !== status
          )
            throw Error("Live route/status mismatch");
          const digest = createHash("sha256");
          let bytes = 0;
          reader = response.body.getReader();
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            if (controller.signal.aborted || remaining() <= 0)
              throw Error("publication-timeout");
            bytes += part.value.length;
            if (bytes > item.bytes || bytes > 2 * 1024 * 1024)
              throw Error("Live route body bound");
            digest.update(part.value);
          }
          if (bytes !== item.bytes || digest.digest("hex") !== item.sha256)
            throw Error("Live route original bytes mismatch");
          probes.push({ path, status, sha256: item.sha256, bytes });
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(Error("publication-timeout"));
          }, timeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      controller.abort();
      try {
        Promise.resolve(reader?.cancel()).catch(() => {});
      } catch {
        /* Cancellation is best effort after the read bound. */
      }
    }
  };
  const index = inventory.find((a) => a.path === "index.html"),
    notFound = inventory.find((a) => a.path === "404.html");
  if (!index || !notFound) throw Error("Missing route originals");
  // Callback is an internal 200 rewrite to exact index, NOT a 302/login redirect.
  for (const [path, status, item] of [
    ["/auth/mdbase/callback", 200, index],
    ["/auth/mdbase/callback/", 200, index],
    ["/more", 200, index],
    ["/more/__cd_policy__", 200, index],
    ["/scratchpad", 200, index],
    ["/scratchpad/", 200, index],
    ["/search", 200, index],
    ["/search/", 200, index],
    ["/task/__cd_policy__", 200, index],
    ["/views", 200, index],
    ["/views/__cd_policy__", 200, index],
    ["/__tasknotes_native_policy_missing__", 404, notFound],
    ["/_headers", 404, notFound],
    ["/_redirects", 404, notFound],
    ["/_routes.json", 404, notFound],
    ["/_worker.js", 404, notFound],
  ]) {
    try {
      await probe(path, status, item);
    } catch {
      failures.push({
        path,
        reason: "trusted-live-route/header-policy-failed",
      });
    }
  }
  let bytes;
  try {
    if (remaining() <= 0) throw Error("publication-timeout");
    // No artifact mappings/options accepted at the CLI. Shared verifier covers ALL
    // actual servable bytes, incl .well-known, static SW, SDK Worker, native/SQLite.
    bytes = await verifyServedBytes(origin, inventory, {
      ...options,
      fetch: transport,
      totalTimeoutMs: remaining(),
    });
  } catch (error) {
    bytes = {
      verified: [],
      unverified: inventory.filter((a) => isControl(a.path)),
      failures: [{ path: "*", reason: error.message }],
    };
  }
  failures.push(...bytes.failures);
  const controls =
    failures.length === 0
      ? bytes.unverified
          .filter((a) => ["_headers", "_redirects"].includes(a.path))
          .map((a) => ({
            path: a.path,
            bytes: a.bytes,
            sha256: a.sha256,
            policy: "trusted-source-and-live-probes",
            probes,
          }))
      : [];
  const unverified = bytes.unverified.filter(
    (a) => !controls.some((c) => c.path === a.path),
  );
  return {
    ...bytes,
    failures,
    unverified,
    controls,
    probes,
    ok:
      failures.length === 0 &&
      unverified.length === 0 &&
      bytes.verified.length + controls.length === inventory.length,
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [planPath, inventoryPath, deploymentPath] = process.argv.slice(2);
    const json = async (path) => JSON.parse(await readFile(path, "utf8"));
    const plan = await json(planPath),
      deployment = await json(deploymentPath);
    if (
      deployment.sourceSha !== plan.sha ||
      deployment.pagesBranch !== plan.pagesBranch
    )
      throw Error("Deployment/source/target mismatch");
    const result = await verifyHosting({
      origin: plan.origin,
      inventory: await json(inventoryPath),
      deployment,
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}
