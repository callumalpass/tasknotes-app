// Canonical SDK offline shell contract, inspected AS DATA ONLY. No eval, import,
// worker execution, candidate script, network request or manifest-file alias.
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { assertInventory } from "./native-publish-bytes.mjs";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const SHELL_RUNTIME = "mdbase-shell-runtime.js";
const marker = "\n// mdbase shared offline shell\n";
const call = `import {installOfflineShell} from "./${SHELL_RUNTIME}";\ninstallOfflineShell(self, `;
const hex = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const keys = (value, expected) =>
  value &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value)) === JSON.stringify(expected);
const fail = () => {
  throw new Error("Invalid canonical embedded offline shell.");
};
export function originalOfflineRuntime(source) {
  if (!Buffer.isBuffer(source) || !source.length || source.length > 1024 * 1024)
    fail();
  // Exact transformation in ORIGINAL SDK offline-shell-build.js. Only remove
  // its source-map directive, never rename/rewrite SDK runtime or emit an alias.
  const text = new TextDecoder("utf-8", { fatal: true }).decode(source);
  const bytes = Buffer.from(text.replace(/\n\/\/# sourceMappingURL=.*$/m, ""));
  return {
    path: SHELL_RUNTIME,
    bytes: bytes.length,
    sha256: hash(bytes),
    originalSourceSha256: hash(source),
  };
}
export function parseEmbeddedOfflineShell(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 2 * 1024 * 1024) fail();
  const code = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!Buffer.from(code).equals(bytes)) fail(); // BOM/non-canonical encoding
  const start = code.indexOf(marker);
  if (start < 0 || code.indexOf(marker, start + marker.length) !== -1) fail();
  const existing = code.slice(0, start);
  const tail = code.slice(start + marker.length);
  if (!tail.startsWith(call) || !tail.endsWith(");\n")) fail();
  const raw = tail.slice(call.length, -3);
  if (Buffer.byteLength(raw) > 1024 * 1024) fail();
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    fail();
  }
  // Round-trip + exact key order rejects duplicate keys, whitespace variants,
  // escape aliases and extra properties. This is JSON, never JavaScript eval.
  if (
    JSON.stringify(manifest) !== raw ||
    !keys(manifest, ["base", "version", "assets"]) ||
    manifest.base !== "/" ||
    !hex(manifest.version) ||
    !Array.isArray(manifest.assets) ||
    !manifest.assets.length ||
    manifest.assets.length > 4096
  )
    fail();
  const seen = new Set();
  let previous = "";
  for (const entry of manifest.assets) {
    if (
      !keys(entry, ["path", "sha256"]) ||
      typeof entry.path !== "string" ||
      entry.path.length > 1024 ||
      !hex(entry.sha256)
    )
      fail();
    const path = entry.path;
    if (
      !/^[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(path) ||
      path.split("/").some((p) => p.startsWith(".") || p.startsWith("_")) ||
      path === "service-worker.js" ||
      !/\.(?:html|js|mjs|css|wasm|woff2?|ttf|svg|png|webp|jpg|jpeg|ico|json|webmanifest)$/.test(
        path,
      )
    )
      fail();
    const url = new URL(path, "https://staging.tasknotes-app.pages.dev/");
    if (
      url.origin !== "https://staging.tasknotes-app.pages.dev" ||
      url.pathname !== "/" + path ||
      url.search ||
      url.hash ||
      seen.has(path.toLowerCase()) ||
      path <= previous
    )
      fail();
    seen.add(path.toLowerCase());
    previous = path;
  }
  if (!seen.has("index.html") || !seen.has(SHELL_RUNTIME)) fail();
  if (
    hash(
      JSON.stringify({
        base: manifest.base,
        assets: manifest.assets,
        existing,
      }),
    ) !== manifest.version
  )
    throw new Error("Embedded offline shell version mismatch.");
  return manifest;
}
async function readVerified(directory, record, maximum) {
  if (!record || !Number.isSafeInteger(record.bytes) || record.bytes > maximum)
    fail();
  const handle = await open(
    join(directory, record.path),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== record.bytes) fail();
    const chunks = [];
    let size = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(65536, maximum - size + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > maximum) fail();
      chunks.push(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    for (const key of ["dev", "ino", "size", "mode", "mtimeMs", "ctimeMs"])
      if (before[key] !== after[key]) fail();
    const bytes = Buffer.concat(chunks);
    if (size !== record.bytes || hash(bytes) !== record.sha256) fail();
    return bytes;
  } finally {
    await handle.close();
  }
}
export async function assertOfflineShell({ directory, assets, sdkTrust }) {
  await assertInventory(directory, assets); // ENTIRE publication inventory, not cache list
  const manifest = parseEmbeddedOfflineShell(
    await readVerified(
      directory,
      assets.find((a) => a.path === "service-worker.js"),
      2 * 1024 * 1024,
    ),
  );
  const runtime = sdkTrust.sdk.offlineShell;
  if (
    !runtime ||
    runtime.path !== SHELL_RUNTIME ||
    !hex(runtime.originalSourceSha256) ||
    !hex(runtime.sha256)
  )
    throw new Error("Missing ORIGINAL SDK offline shell runtime binding.");
  const shell = assets.find((a) => a.path === SHELL_RUNTIME);
  if (
    !shell ||
    shell.bytes !== runtime.bytes ||
    shell.sha256 !== runtime.sha256
  )
    throw new Error("Offline shell runtime differs from ORIGINAL SDK bytes.");
  await readVerified(directory, shell, 1024 * 1024);
  for (const entry of manifest.assets) {
    const actual = assets.find((a) => a.path === entry.path);
    if (!actual || actual.sha256 !== entry.sha256)
      throw new Error("Embedded offline asset hash/path mismatch.");
  }
  await assertInventory(directory, assets);
  return manifest;
}
