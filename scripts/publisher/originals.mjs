// Data-only intake. Authenticate original SDKs before any candidate dependency executes.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  authenticateProduction,
  stagingArchive,
  publicBytes,
  archiveBytes,
} from "./authentication.mjs";
import { assertSdkFloor } from "./release-gates.mjs";
import { originalOfflineRuntime } from "../lib/native-offline-shell.mjs";
const hash = (bytes, algorithm = "sha256") =>
  createHash(algorithm)
    .update(bytes)
    .digest(algorithm === "sha512" ? "base64" : "hex");
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
export const digestNames = ["TASKNOTES_TRUST_ASSET_SHA256"];
export function protectedHashes(env = process.env) {
  assert.match(
    env.TASKNOTES_TRUST_ASSET_SHA256 ?? "",
    /^[a-f0-9]{64}$/,
    "protected TASKNOTES_TRUST_ASSET_SHA256 required",
  );
  return { TASKNOTES_TRUST_ASSET_SHA256: env.TASKNOTES_TRUST_ASSET_SHA256 };
}
export function originalMembers(bytes) {
  if (typeof bytes === "string") bytes = readFileSync(bytes);
  return JSON.parse(
    execFileSync(
      "python3",
      ["-B", fileURLToPath(new URL("./archive-members.py", import.meta.url))],
      { input: bytes, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    ),
  );
}
function member(bytes, path) {
  assert(
    originalMembers(bytes).some((m) => m.path === path),
    "missing SDK original",
  );
  return execFileSync("tar", ["-xOzf", "-", `package/${path}`], {
    input: bytes,
    maxBuffer: 128 * 1024 * 1024,
  });
}
async function regular(root, path) {
  assert(
    path
      .split("/")
      .every((p) => /^[\w.@~-]+$/.test(p) && p !== "." && p !== ".."),
    "unsafe original path",
  );
  const full = join(root, path);
  assert(
    (await lstat(full)).isFile() && (await realpath(full)) === full,
    "nonregular original",
  );
  return readFile(full);
}
export async function installedMembers(root, ignored = new Set()) {
  const rows = [];
  async function walk(dir, prefix = "") {
    for (const name of await readdir(dir)) {
      const path = join(dir, name),
        rel = prefix + name,
        stat = await lstat(path);
      if (ignored.has(rel)) continue; // Installer-only namespace, only if archive owns no member there.
      assert(!stat.isSymbolicLink(), "installed original symlink");
      if (stat.isDirectory()) await walk(path, rel + "/");
      else {
        assert(
          stat.isFile() &&
            stat.size <= 128 * 1024 * 1024 &&
            rows.length < 10000,
          "installed original bound",
        );
        const bytes = await readFile(path);
        rows.push({ path: rel, bytes: bytes.length, sha256: hash(bytes) });
      }
    }
  }
  await walk(root);
  return rows.sort((a, b) => (a.path < b.path ? -1 : 1));
}
export async function productionPin(root) {
  const pkg = await json(join(root, "package.json")),
    spec = pkg.dependencies["@mdbase-dev/sdk"];
  assert.match(
    spec,
    /^file:vendor\/[\w.-]+\.tgz$/,
    "committed SDK original required",
  );
  const directory = "vendor",
    pins = [];
  for (const name of await readdir(join(root, directory)))
    if (/^sdk-production-[\w.-]+\.json$/.test(name)) {
      const pin = await json(join(root, directory, name));
      if (
        pin.artifact === spec.slice("file:vendor/".length) &&
        pin.environment === "production"
      )
        pins.push(pin);
    }
  assert.equal(pins.length, 1, "unique production SDK pin required");
  const pin = pins[0],
    bytes = await regular(root, directory + "/" + pin.artifact);
  assert.equal(pin.schema, "tnapp/production-sdk-original/1");
  assert.equal(pin.sha256, hash(bytes), "committed SDK archive mismatch");
  assert.equal(pin.bytes, bytes.length);
  assert.equal(pin.sri, "sha512-" + hash(bytes, "sha512"));
  assert.equal(pin.publication.repository, "mdbase-dev/mdbase-connect");
  assert.equal(
    pin.publication.workflow,
    ".github/workflows/publish-sdk-npm.yml",
  );
  assert(
    ["refs/heads/main", "refs/tags/v" + pin.version].includes(
      pin.publication.ref,
    ),
  );
  return { pin, bytes, spec };
}
export async function compareInstalled(
  root,
  archives,
  { fetchImpl = fetch } = {},
) {
  const spaces = [{ path: ".", pkg: await json(join(root, "package.json")) }];
  for (const archive of Object.values(archives)) {
    const bytes = archive.path.startsWith("https:")
      ? await archiveBytes(archive.path, fetchImpl)
      : await regular(root, archive.path);
    assert.equal(hash(bytes), archive.sha256, "comparison archive changed");
    const members = originalMembers(bytes),
      owns = (path) =>
        members.some((m) => m.path === path || m.path.startsWith(path + "/"));
    const ignored = !owns("node_modules")
      ? new Set(["node_modules"])
      : !owns("node_modules/.bin")
        ? new Set(["node_modules/.bin"])
        : new Set();
    for (const { path, pkg } of spaces)
      if (pkg.dependencies?.[archive.name]) {
        const installed = await realpath(
          join(root, path, "node_modules", archive.name),
        );
        assert(
          !relative(root, installed).startsWith(".."),
          "installed originals outside checkout",
        );
        assert.deepEqual(
          await installedMembers(installed, ignored),
          members,
          "ALL installed originals differ: " + path + "/" + archive.name,
        );
      }
  }
}
export async function loadOriginals({
  target,
  repoRoot,
  hashes,
  installed = false,
  fetchImpl = fetch,
  authenticate = authenticateProduction,
  stage = stagingArchive,
}) {
  assert(["production", "staging"].includes(target));
  protectedHashes(hashes);
  const { pin, bytes: production, spec } = await productionPin(repoRoot);
  const lockBytes = await readFile(join(repoRoot, "pnpm-lock.yaml")),
    lock = lockBytes.toString();
  const auth = await authenticate(pin, production, { fetchImpl });
  const archives = {};
  const productionPath = "vendor/" + pin.artifact;
  const sdkEntry = lock
    .split("\n  '@mdbase-dev/sdk@" + spec + "':\n")[1]
    ?.split(/\n {2}[^ ]/)[0];
  assert(sdkEntry?.includes("integrity: " + pin.sri), "frozen SDK integrity");
  assert(
    lock.includes(
      "'@mdbase-dev/sdk':\n        specifier: " +
        spec +
        "\n        version: " +
        spec,
    ),
    "frozen SDK importer",
  );
  await assertSdkFloor(pin, { fetchImpl });
  let bytes = production,
    authentication = auth,
    sdkPath = productionPath;
  if (target === "staging") {
    const verified = await stage(pin, { fetchImpl });
    bytes = verified.bytes;
    authentication = verified.authentication;
    sdkPath = verified.path;
    assert.equal(
      authentication.source,
      pin.sourceCommit,
      "staging producer mismatch",
    );
    assert.match(
      sdkPath,
      /^https:\/\/github.com\/mdbase-dev\/mdbase-connect\/releases\/download\/sdk-v[\w.-]+\/sdk-staging.tgz$/,
    );
  }
  archives.sdk = {
    name: "@mdbase-dev/sdk",
    path: sdkPath,
    bytes: bytes.length,
    sha256: hash(bytes),
    sri: "sha512-" + hash(bytes, "sha512"),
  };
  const rootPackage = await json(join(repoRoot, "package.json"));
  for (const [name, specifier] of Object.entries(rootPackage.dependencies)) {
    if (name === "@mdbase-dev/sdk" || !specifier.startsWith("file:")) continue;
    assert.match(
      specifier,
      /^file:vendor\/[\w.-]+\.tgz$/,
      "vendored original required",
    );
    const path = specifier.slice(5),
      original = await regular(repoRoot, path);
    const key = name + "@" + specifier;
    const entry = (
      lock.split("\n  '" + key + "':\n")[1] ??
      lock.split("\n  " + key + ":\n")[1]
    )?.split(/\n {2}[^ ]/)[0];
    assert(
      entry?.includes("integrity: sha512-" + hash(original, "sha512")),
      "frozen original integrity: " + name,
    );
    archives[name] = { name, path, sha256: hash(original) };
  }
  const pkg = await json(join(repoRoot, "package.json")),
    version = pkg.dependencies["@mdbase-dev/ui"];
  assert.match(version, /^\d+\.\d+\.\d+-[\w.]+$/);
  const uiEntry = lock
    .split(`\n  '@mdbase-dev/ui@${version}':\n`)[1]
    ?.split(/\n {2}[^ ]/)[0];
  const integrity =
    /resolution: \{integrity: (sha512-[A-Za-z0-9+/]+={0,2})\}/.exec(
      uiEntry ?? "",
    )?.[1];
  assert(integrity, "frozen UI integrity required");
  const uiPath = `https://registry.npmjs.org/@mdbase-dev/ui/-/ui-${version}.tgz`,
    ui = await publicBytes(uiPath, fetchImpl);
  assert.equal(
    "sha512-" + hash(ui, "sha512"),
    integrity,
    "UI frozen archive integrity",
  );
  archives.ui = { name: "@mdbase-dev/ui", path: uiPath, sha256: hash(ui) };
  const publication = (
    await json(join(repoRoot, "config/sdk-publication.json"))
  ).sdkPublication;
  const trust = publication.environments[target],
    provenance = JSON.parse(member(bytes, "dist/native/provenance.json"));
  const manifest = JSON.parse(member(bytes, "package.json"));
  assert.equal(manifest.name, trust.package);
  assert.equal(manifest.version, pin.version);
  assert.equal(provenance.schema, "mdbase-sdk/npm-publication/1");
  assert.equal(provenance.commit, pin.sourceCommit);
  assert.equal(provenance.environment, target);
  assert.deepEqual(provenance.trust, trust);
  const module = member(bytes, "dist/application/packaged-trust.js");
  const literal = /^const metadata = (\{.*\});$/m.exec(module.toString());
  assert(literal, "packaged trust literal");
  const release = JSON.parse(literal[1]);
  assert.equal(release.environment, target);
  assert.equal(release.cpOrigin, trust.cpOrigin);
  assert.equal(release.logOrigin, trust.logOrigin);
  assert.deepEqual(release.source, {
    repository: "mdbase-dev/mdbase-connect",
    commit: trust.sourceCommit,
    version: trust.sourceVersion,
  });
  for (const digest of [
    release.assetSha256,
    trust.sha256,
    hash(await regular(repoRoot, `config/next-trust/${target}.json`)),
  ])
    assert.equal(
      digest,
      hashes.TASKNOTES_TRUST_ASSET_SHA256,
      "protected trust hash mismatch",
    );
  const assetPins = JSON.parse(
      member(bytes, "dist/application/asset-pins.json"),
    ),
    nativeAssets = {};
  assert.deepEqual(assetPins.runtime, provenance.runtime);
  for (const [name, pin] of [
    ["runtime.wasm", assetPins.runtime],
    ["sqlite3.wasm", assetPins.sqlite],
    ["sqlite3.js", assetPins.sqlite.initializer],
  ]) {
    const original = member(bytes, "dist/native/" + name);
    assert.equal(pin.sha256, hash(original));
    assert.equal(pin.bytes, original.length);
    nativeAssets[name] = { sha256: hash(original), bytes: original.length };
  }
  const offlineShell = originalOfflineRuntime(
    member(bytes, "dist/offline-shell-worker.js"),
  );
  if (installed) await compareInstalled(repoRoot, archives, { fetchImpl });
  return {
    environment: target,
    release,
    nativeAssets,
    offlineShell,
    archives,
    authentication,
    lockSha256: hash(lockBytes),
    protectedHashes: hashes,
    production: { path: productionPath, sri: pin.sri, version: pin.version },
    sdkSource: pin.sourceCommit,
    trust,
    appOrigin:
      target === "production"
        ? "https://app.tasknotes.dev"
        : "https://staging.tasknotes.dev",
  };
}
