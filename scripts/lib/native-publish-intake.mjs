// Source-reviewed byte binding to the ONCE OFF-CI authenticated TNAPP/NX-TRUST
// handoff. This module neither authenticates signatures nor executes SDK code.
import { createHash } from "node:crypto";
import { readFile, realpath, lstat, readdir, open } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { isDeepStrictEqual } from "node:util";
import { assertGeneratedYamlShim } from "./native-pnpm-generated.mjs";
import {
  assertInventory,
  inventoryDirectory,
} from "./native-publish-bytes.mjs";

export const digest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
const sri = (bytes) =>
  `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
const equal = (a, b, label) => {
  if (!isDeepStrictEqual(a, b)) throw new Error(`${label} mismatch.`);
};
function safePath(path) {
  if (
    typeof path !== "string" ||
    !path ||
    path
      .split("/")
      .some(
        (p, i, parts) =>
          (!/^[a-zA-Z0-9._~-]+$/.test(p) &&
            !(
              parts[i - 1] === "node_modules" &&
              /^@[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(p)
            )) ||
          p === "." ||
          p === "..",
      )
  )
    throw new Error("Unsafe intake path.");
  return path;
}
const json = (bytes) => JSON.parse(bytes.toString("utf8"));
const record = (path, bytes) => ({
  path,
  bytes: bytes.length,
  sha256: digest(bytes),
});

/** Bounded USTAR npm reader. Reject links, duplicate names, traversal, extension
 * records and non-regular types rather than extracting a candidate archive. */
export function readNpmArchive(compressed) {
  if (compressed.length > 128 * 1024 * 1024)
    throw new Error("Archive compressed size limit.");
  const tar = gunzipSync(compressed, { maxOutputLength: 512 * 1024 * 1024 });
  const files = new Map();
  const names = new Set();
  let offset = 0;
  const string = (b) => b.toString("utf8").replace(/\0.*$/s, "");
  const octal = (b) => {
    const v = string(b).trim();
    if (!/^[0-7]+$/.test(v)) throw new Error("Invalid tar numeric field.");
    return parseInt(v, 8);
  };
  while (
    offset + 512 <= tar.length &&
    tar.subarray(offset, offset + 512).some((b) => b !== 0)
  ) {
    if (names.size >= 20000) throw new Error("Archive member count limit.");
    const header = tar.subarray(offset, offset + 512);
    const checksum = octal(header.subarray(148, 156));
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
    if (sum !== checksum) throw new Error("Tar checksum mismatch.");
    const prefix = string(header.subarray(345, 500));
    const name = (prefix ? `${prefix}/` : "") + string(header.subarray(0, 100));
    const type = header[156];
    const directory = type === 53;
    const canonical =
      directory && name.endsWith("/") ? name.slice(0, -1) : name;
    safePath(canonical);
    if (!canonical.startsWith("package/") && canonical !== "package")
      throw new Error("Not an original npm member.");
    if (names.has(canonical.toLowerCase()))
      throw new Error("Duplicate tar member.");
    names.add(canonical.toLowerCase());
    if (![0, 48, 53].includes(type))
      throw new Error("Tar link or unsupported member type.");
    const bytes = octal(header.subarray(124, 136));
    if (
      bytes > 128 * 1024 * 1024 ||
      offset + 512 + bytes > tar.length ||
      (directory && bytes)
    )
      throw new Error("Invalid tar member size.");
    if (!directory)
      files.set(
        canonical.slice(8),
        tar.subarray(offset + 512, offset + 512 + bytes),
      );
    offset += 512 + Math.ceil(bytes / 512) * 512;
  }
  if (offset + 1024 > tar.length || tar.subarray(offset).some((b) => b !== 0))
    throw new Error("Invalid tar terminator.");
  for (const name of files.keys()) {
    const parts = name.split("/");
    for (let i = 1; i < parts.length; i++)
      if (files.has(parts.slice(0, i).join("/")))
        throw new Error("Tar file/directory collision.");
  }
  if (!files.size) throw new Error("Empty npm archive.");
  return files;
}

/** npm packages legitimately contain node_modules/@scope members, unlike the
 * shared URL/upload helper's conservative path subset. Compare ALL installed
 * originals with nofollow reads, path-set equality, budgets and mutation checks. */
async function inventoryInstalledNpm(root) {
  const files = [];
  let total = 0,
    entries = 0;
  const stable = (a, b) =>
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mode === b.mode &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs;
  const checked = async (path) => {
    const s = await lstat(path);
    if (s.isSymbolicLink())
      throw new Error("Installed member symlink refuses.");
    return s;
  };
  let current = sep;
  for (const part of resolve(root).slice(1).split(sep)) {
    current = join(current, part);
    if (!(await checked(current)).isDirectory())
      throw new Error("Installed parent not directory.");
  }
  async function walk(dir, prefix, depth) {
    if (depth > 32) throw new Error("Installed depth limit.");
    const before = await checked(dir);
    if (!before.isDirectory())
      throw new Error("Installed nonregular directory.");
    for (const name of await readdir(dir)) {
      if (++entries > 20000) throw new Error("Installed member count limit.");
      const path = prefix ? `${prefix}/${name}` : name;
      safePath(path);
      const filename = join(dir, name),
        initial = await checked(filename);
      if (initial.isDirectory()) {
        await walk(filename, path, depth + 1);
        continue;
      }
      if (
        !initial.isFile() ||
        initial.size > 128 * 1024 * 1024 ||
        (total += initial.size) > 512 * 1024 * 1024
      )
        throw new Error("Installed type/size limit.");
      const handle = await open(
        filename,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        if (!stable(initial, await handle.stat()))
          throw new Error("Installed member changed.");
        const hash = createHash("sha256");
        const buffer = Buffer.alloc(65536);
        let bytes = 0;
        while (true) {
          const { bytesRead } = await handle.read(
            buffer,
            0,
            Math.min(buffer.length, initial.size - bytes + 1),
            null,
          );
          if (!bytesRead) break;
          bytes += bytesRead;
          if (bytes > initial.size) throw new Error("Installed member grew.");
          hash.update(buffer.subarray(0, bytesRead));
        }
        if (
          bytes !== initial.size ||
          !stable(initial, await handle.stat()) ||
          !stable(initial, await checked(filename))
        )
          throw new Error("Installed member changed.");
        files.push({ path, bytes, sha256: hash.digest("hex") });
      } finally {
        await handle.close();
      }
    }
    if (!stable(before, await checked(dir)))
      throw new Error("Installed directory changed.");
  }
  await walk(root, "", 0);
  return files.sort((a, b) => a.path.localeCompare(b.path, "en"));
}

/** Reviewed APP intake config, not a fork of any SDK/public contract. No target
 * config is shipped until actual target originals and review are available. */
export async function verifyOriginalIntake({
  root,
  target,
  approvedHashes,
  installed = false,
}) {
  const configPath = join(
    root,
    "config/native-publish",
    `${target.environment}.json`,
  );
  let config;
  try {
    config = json(await readFile(configPath));
  } catch (cause) {
    throw new Error(
      "Missing actual reviewed target intake; LAB inputs cannot publish.",
      { cause },
    );
  }
  equal(config.environment, target.environment, "Intake environment");
  const packet = join(root, "vendor/native-publish", target.environment);
  // Exact reviewed packet path-set/digests, NOT candidate self-asserted facts.
  await assertInventory(packet, config.packetFiles);
  equal(
    digest(await readFile(join(root, "pnpm-lock.yaml"))),
    config.lockSha256,
    "Frozen lock",
  );
  const read = async (path) => readFile(join(packet, safePath(path)));
  const packageJson = json(await readFile(join(root, "package.json")));
  const lock = await readFile(join(root, "pnpm-lock.yaml"), "utf8");
  const packages = {};
  for (const [key, name] of [
    ["sdk", "@mdbase-dev/sdk"],
    ["ui", "@mdbase-dev/ui"],
    ["protocol", "@mdbase-dev/connect-protocol"],
  ]) {
    const expected = config.archives?.[key];
    if (
      !expected ||
      !/^[a-f0-9]{64}$/.test(expected.sha256) ||
      !/^[a-f0-9]{40}$/.test(expected.source) ||
      (key === "sdk" && !/^[a-f0-9]{40}$/.test(expected.sourceTree))
    )
      throw new Error("Missing reviewed archive expectations.");
    safePath(expected.archive);
    if (expected.archive.includes("/"))
      throw new Error("Original archive must retain basename.");
    equal(
      packageJson.dependencies?.[name],
      `file:vendor/${expected.archive}`,
      `${name} original pin`,
    );
    const bytes = await readFile(join(root, "vendor", expected.archive));
    equal(
      record(expected.archive, bytes),
      {
        path: expected.archive,
        bytes: expected.bytes,
        sha256: expected.sha256,
      },
      `${key} original archive`,
    );
    equal(sri(bytes), expected.sri, `${key} original SRI`);
    if (
      !lock.includes(`tarball: file:vendor/${expected.archive}`) ||
      !lock.includes(`integrity: ${expected.sri}`)
    )
      throw new Error("Frozen lock missing original archive/SRI.");
    if (approvedHashes)
      equal(expected.sha256, approvedHashes[key], `${key} protected original`);
    let facts, companion;
    if (key === "sdk") {
      const raw = await read(expected.facts);
      equal(
        digest(raw),
        expected.factsSha256,
        "Independently pinned SDK public facts",
      );
      facts = json(raw); // ORIGINAL canonical public SDK facts, never reauthored.
      for (const field of [
        "archive",
        "bytes",
        "sha256",
        "sri",
        "source",
        "sourceTree",
      ])
        equal(facts[field], expected[field], `${key} facts ${field}`);
      if (facts.noPublication === true)
        throw new Error("noPublication SDK original refuses.");
    } else if (key === "ui") {
      // UI uses its EXISTING companion convention, not fabricated SDK facts.
      const raw = await read(expected.companion);
      equal(digest(raw), expected.companionSha256, "Original UI companion");
      companion = json(raw);
      for (const [field, value] of [
        ["artifact", expected.archive],
        ["bytes", expected.bytes],
        ["sha256", expected.sha256],
        ["integrity", expected.sri],
        ["sourceCommit", expected.source],
      ])
        equal(companion[field], value, `UI original companion ${field}`);
    }
    const members = readNpmArchive(bytes);
    const inventory = [...members]
      .map(([path, data]) => record(path, data))
      .sort((a, b) => a.path.localeCompare(b.path, "en"));
    const publishedMembers =
      key === "sdk" ? json(await read(expected.members)) : expected.members;
    // Normalize ordering only, never names/bytes. assertInventory validates
    // paths/duplicates separately when installed; equality here covers archives.
    equal(
      inventory,
      [...publishedMembers].sort((a, b) => a.path.localeCompare(b.path, "en")),
      `${key} EVERY original member`,
    );
    if (key === "sdk")
      equal(members.size, facts.members, `${key} member count`);
    equal(json(members.get("package.json")).name, name, `${key} package name`);
    if (installed) {
      // pnpm's package-root link is expected, links INSIDE the package are not.
      const location = await realpath(join(root, "node_modules", name));
      const store = resolve(root, "node_modules", ".pnpm") + sep;
      if (!location.startsWith(store))
        throw new Error("Installed package escaped frozen pnpm store.");
      let actual = await inventoryInstalledNpm(location);
      const shim = actual.find(
        (item) => item.path === "node_modules/.bin/yaml",
      );
      if (["sdk", "protocol"].includes(key) && shim) {
        const bytes = await readFile(join(location, shim.path));
        equal(digest(bytes), shim.sha256, "Generated install shim stable read");
        const yamlMembers = key === "sdk" ? members : packages.sdk.members;
        let externalYamlRoot = null;
        if (key === "protocol") {
          const yaml = json(yamlMembers.get("node_modules/yaml/package.json"));
          if (!/^\d+\.\d+\.\d+$/.test(yaml.version))
            throw new Error("Unqualified original YAML version.");
          externalYamlRoot = resolve(
            root,
            `node_modules/.pnpm/yaml@${yaml.version}/node_modules/yaml`,
          );
          const originalYaml = [...yamlMembers]
            .filter(([path]) => path.startsWith("node_modules/yaml/"))
            .map(([path, data]) =>
              record(path.slice("node_modules/yaml/".length), data),
            )
            .sort((a, b) => a.path.localeCompare(b.path, "en"));
          equal(
            await inventoryInstalledNpm(externalYamlRoot),
            originalYaml,
            "Registry YAML EVERY member versus SDK bundled ORIGINAL",
          );
        }
        assertGeneratedYamlShim({
          bytes,
          packageRoot: location,
          projectRoot: root,
          members: yamlMembers,
          packageManager: packageJson.packageManager,
          externalYamlRoot,
        });
        console.log(
          JSON.stringify({
            kind: "separate-pnpm-10.7-generated-install-output-NOT-original-member",
            ...shim,
          }),
        );
        actual = actual.filter((item) => item.path !== shim.path); // ONE byte-qualified installer output only
      }
      if (!isDeepStrictEqual(actual, inventory)) {
        const wanted = new Map(inventory.map((item) => [item.path, item]));
        const found = new Map(actual.map((item) => [item.path, item]));
        const differences = [...wanted]
          .filter(([path, item]) => !isDeepStrictEqual(item, found.get(path)))
          .map(([path, item]) => ({
            path,
            expected: item,
            actual: found.get(path) ?? null,
          }));
        differences.push(
          ...actual
            .filter((item) => !wanted.has(item.path))
            .map((item) => ({ path: item.path, expected: null, actual: item })),
        );
        throw new Error(
          `${key} installed inventory-mismatch: ${JSON.stringify({ expectedMembers: inventory.length, installedMembers: actual.length, differences: differences.slice(0, 20) })}`,
        );
      }
    }
    packages[key] = { expected, facts, companion, members, inventory };
  }
  const { sdk, ui, protocol } = packages;
  const publicationConstraints = [];
  if (ui.companion.noPublication === true)
    publicationConstraints.push("UI companion noPublication=true");
  if (ui.companion.pairedSdkSource !== sdk.facts.source)
    publicationConstraints.push(
      `UI companion pairedSdkSource=${ui.companion.pairedSdkSource} is not paired with SDK ${sdk.facts.source}`,
    );
  const dependency = sdk.facts.dependencies?.find(
    (d) => d.name === "@mdbase-dev/connect-protocol",
  );
  for (const [field, expected] of [
    ["file", `vendor/${protocol.expected.archive}`],
    ["bytes", protocol.expected.bytes],
    ["sha256", protocol.expected.sha256],
    ["sri", protocol.expected.sri],
  ])
    equal(dependency?.[field], expected, `SDK protocol dependency ${field}`);
  const bundled = sdk.members.get(`vendor/${protocol.expected.archive}`);
  if (!bundled || digest(bundled) !== protocol.expected.sha256)
    throw new Error("SDK bundled protocol original mismatch.");
  for (const [path, bytes] of protocol.members) {
    const actual = sdk.members.get(
      `node_modules/@mdbase-dev/connect-protocol/${path}`,
    );
    if (!actual || !actual.equals(bytes))
      throw new Error("SDK bundled protocol member mismatch.");
  }
  const provenanceRaw = sdk.members.get("dist/native/provenance.json");
  if (
    !provenanceRaw ||
    !provenanceRaw.equals(
      await read(config.provenancePath ?? "provenance.json"),
    )
  )
    throw new Error("Original provenance copy mismatch.");
  const provenance = json(provenanceRaw);
  const handoff = (path) =>
    read(
      config.handoffDirectory
        ? `${safePath(config.handoffDirectory)}/${path}`
        : path,
    );
  const contextRaw = await handoff(
    `next-trust/${target.environment}-context.json`,
  );
  const context = json(contextRaw);
  const receiptRaw = await read("sdk-build-receipt.json");
  const receipt = json(receiptRaw);
  const asset = await handoff(`next-trust/${target.environment}.json`);
  const releaseInventory = json(await handoff("release-trust-bundle.json"));
  const trust = provenance.trust;
  equal(
    provenance.schema,
    "mdbn-sdk/application-assets/1",
    "SDK provenance schema",
  );
  equal(provenance.environment, target.environment, "SDK environment");
  equal(trust?.environment, target.environment, "Trust environment");
  equal(trust?.cpOrigin, target.connectOrigin, "Target CP");
  equal(trust?.logOrigin, config.logOrigin, "Authenticated log origin");
  if (
    new URL(config.logOrigin).origin !== config.logOrigin ||
    !config.logOrigin.startsWith("https://")
  )
    throw new Error("Exact HTTPS log origin required.");
  equal(context.schema_version, 1, "Ops context version");
  equal(context.kind, "mdbase-next-build-trust-context", "Ops context kind");
  equal(
    context.context,
    {
      ...context.context,
      sha256: digest(asset),
      environment: target.environment,
      control_plane_origin: target.connectOrigin,
      log_origin: config.logOrigin,
      source: {
        repository: "mdbase-dev/mdbase-connect",
        commit: trust.sourceCommit,
        version: trust.sourceVersion,
      },
    },
    "Ops context target/source/asset",
  );
  const image = json(await handoff("image-release-bundle.json"));
  const source = context.context.source;
  for (const input of [
    releaseInventory,
    image,
    releaseInventory.trustAssets?.[0]?.source,
  ]) {
    if (!input) throw new Error("Missing original release source binding.");
    for (const key of ["repository", "commit", "version"])
      equal(input[key], source[key], `Original release source ${key}`);
  }
  equal(releaseInventory.schemaVersion, 1, "Release inventory version");
  equal(
    releaseInventory.kind,
    "mdbase-release-trust-bundle",
    "Release inventory kind",
  );
  equal(releaseInventory.trustAssets.length, 1, "Single target trust asset");
  const entry = releaseInventory.trustAssets[0];
  for (const [key, value] of [
    ["path", provenance.handoff.asset_path],
    ["length", asset.length],
    ["environment", target.environment],
    ["controlPlaneOrigin", target.connectOrigin],
    ["logOrigin", config.logOrigin],
  ])
    equal(entry[key], value, `Release inventory ${key}`);
  const h = provenance.handoff;
  for (const [run, expected, publisher] of [
    [image.publication, h.image_publication, false],
    [releaseInventory.publication, h.trust_publication, true],
    [releaseInventory.qualification, h.publisher_qualification, false],
  ]) {
    if (
      !Number.isSafeInteger(expected?.run_id) ||
      expected.run_id < 1 ||
      !Number.isSafeInteger(expected?.run_attempt) ||
      expected.run_attempt < 1
    )
      throw new Error("Missing original run/attempt.");
    equal(run?.runId, expected.run_id, "Original run ID");
    equal(run?.runAttempt, expected.run_attempt, "Original run attempt");
    if (publisher)
      equal(
        run?.publisherCommit,
        expected.publisher_commit,
        "Publisher commit",
      );
  }
  equal(
    releaseInventory.imageBundle,
    {
      path: "image-release-bundle.json",
      length: (await handoff("image-release-bundle.json")).length,
      sha256: h.proof_sha256["image-release-bundle.json"],
      publicationRunId: h.image_publication.run_id,
      publicationRunAttempt: h.image_publication.run_attempt,
    },
    "Original image inventory binding",
  );
  const expectedAsset = config.assetSha256;
  if (!/^[a-f0-9]{64}$/.test(expectedAsset))
    throw new Error("Missing reviewed raw trust asset hash.");
  if (approvedHashes)
    equal(
      expectedAsset,
      approvedHashes.asset,
      "Fourth protected raw trust ASSET",
    );
  for (const value of [
    digest(asset),
    trust.sha256,
    context.context.sha256,
    releaseInventory.trustAssets?.[0]?.sha256,
  ])
    equal(value, expectedAsset, "Original signed trust ASSET");
  equal(provenance.handoff.contextSha256, digest(contextRaw), "Context bytes");
  equal(
    provenance.handoff.receiptSha256,
    digest(receiptRaw),
    "SDK receipt bytes",
  );
  equal(
    provenance.handoff.asset_path,
    `next-trust/${target.environment}.json`,
    "Trust asset path",
  );
  equal(provenance.handoff.asset_length, asset.length, "Trust asset length");
  equal(receipt.schema, "mdbn-sdk/application-build/1", "SDK receipt schema");
  equal(receipt.contextSha256, digest(contextRaw), "SDK receipt context");
  equal(
    receipt.verifierSha256,
    provenance.verifier?.sha256,
    "Verifier receipt hash",
  );
  equal(
    receipt.verifierSourceCommit,
    provenance.verifier?.source,
    "Verifier receipt source",
  );
  equal(
    provenance.verifier,
    config.verifier,
    "Reviewed qualified verifier identity",
  );
  equal(provenance.verifier.clockOverride, false, "No clock override");
  for (const name of [
    "image-release-bundle.json",
    "image-release-bundle.sigstore.json",
    "release-trust-bundle.json",
    "release-trust-bundle.sigstore.json",
  ])
    equal(
      digest(await handoff(name)),
      provenance.handoff.proof_sha256?.[name],
      `Original proof ${name}`,
    );
  for (const key of [
    "asset_path",
    "asset_length",
    "proof_sha256",
    "image_publication",
    "trust_publication",
    "publisher_qualification",
  ])
    equal(
      provenance.handoff[key],
      context.provenance[key],
      `Context provenance ${key}`,
    );
  // These reviewed run/source references bind the normal OFF-CI owner handoff;
  // matching them is NOT a fresh signature/full-chain/expiry verification.
  for (const key of [
    "image_publication",
    "trust_publication",
    "publisher_qualification",
  ])
    equal(provenance.handoff[key], config[key], `Reviewed ${key}`);
  equal(
    sdk.facts.nativeSource,
    provenance.runtime.source.commit,
    "SDK facts native source",
  );
  equal(
    sdk.facts.nativeSha256,
    provenance.runtime.sha256,
    "SDK facts native hash",
  );
  equal(
    sdk.facts.nativeBytes,
    provenance.runtime.bytes,
    "SDK facts native length",
  );
  equal(provenance.runtime, config.runtime, "Reviewed native runtime");
  equal(provenance.sqlite, config.sqlite, "Reviewed SQLite");
  for (const [path, entry] of [
    ["dist/native/runtime.wasm", provenance.runtime],
    ["dist/native/sqlite3.wasm", provenance.sqlite],
    ["dist/native/sqlite3.js", provenance.sqlite.initializer],
  ]) {
    const bytes = sdk.members.get(path);
    if (
      !bytes ||
      digest(bytes) !== entry.sha256 ||
      bytes.length !== entry.bytes
    )
      throw new Error("Native/SQLite original member mismatch.");
    if (entry.maxBytes !== undefined && bytes.length > entry.maxBytes)
      throw new Error("Native member resource ceiling.");
  }
  const module = sdk.members.get("dist/application/packaged-trust.js");
  const literal = module?.toString().match(/const metadata = (\{[^\n]+\});/);
  const metadata = literal ? json(Buffer.from(literal[1])) : null;
  equal(
    metadata?.schema,
    "mdbn-app-trust/release/1",
    "Packaged release schema",
  );
  for (const [key, value] of [
    ["environment", target.environment],
    ["cpOrigin", target.connectOrigin],
    ["logOrigin", config.logOrigin],
    ["assetSha256", expectedAsset],
    ["source", context.context.source],
  ])
    equal(metadata?.[key], value, `Compiled appReleaseTrust ${key}`);
  return {
    sdk: {
      ...sdk.expected,
      trust: { ...trust, packagedTrustSha256: digest(module) },
      native: {
        sha256: provenance.runtime.sha256,
        sqliteSha256: provenance.sqlite.sha256,
        sqliteInitializerSha256: provenance.sqlite.initializer.sha256,
      },
    },
    ui: ui.expected,
    protocol: protocol.expected,
    provenance,
    publicationConstraints,
    originalMemberCounts: Object.fromEntries(
      Object.entries(packages).map(([key, value]) => [key, value.members.size]),
    ),
    intakeConfigSha256: digest(await readFile(configPath)),
    packetInventory: await inventoryDirectory(packet),
  };
}

/** LIVE publisher guard: byte custody is necessary, never publication approval.
 * Consumer qualification may inspect original bytes separately; no option or
 * environment switch can bypass these guards on the protected publisher. */
export async function verifyTargetIntake(options) {
  const result = await verifyOriginalIntake(options);
  if (result.publicationConstraints.length)
    throw new Error(result.publicationConstraints.join("; "));
  return result;
}
