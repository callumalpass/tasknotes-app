import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { test } from "node:test";
import {
  digest,
  readNpmArchive,
  verifyTargetIntake,
} from "./lib/native-publish-intake.mjs";
import { inventoryDirectory } from "./lib/native-publish-bytes.mjs";
import { NATIVE_PUBLISH_TARGETS } from "./native-publisher.mjs";

const target = NATIVE_PUBLISH_TARGETS.staging;
const j = (value) => Buffer.from(JSON.stringify(value));
const sri = (bytes) =>
  `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
function tar(entries) {
  const chunks = [];
  for (const [name, data, type = "0"] of entries) {
    const bytes = Buffer.from(data);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write("0000644\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(bytes.length.toString(8).padStart(11, "0") + "\0", 124);
    header.write("00000000000\0", 136);
    header.fill(32, 148, 156);
    header.write(type, 156);
    header.write("ustar\0", 257);
    const sum = [...header].reduce((a, b) => a + b, 0);
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    chunks.push(
      header,
      bytes,
      Buffer.alloc((512 - (bytes.length % 512)) % 512),
    );
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "tn-publish-intake-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packet = join(root, "vendor/native-publish/staging");
  await mkdir(packet, { recursive: true });
  const put = async (path, bytes) => {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), bytes);
  };
  const pput = (path, bytes) =>
    put(`vendor/native-publish/staging/${path}`, bytes);
  const asset = Buffer.from(
    "RAW original SIGNED envelope bytes; synthetic unit fixture ONLY",
  );
  const source = {
    repository: "mdbase-dev/mdbase-connect",
    commit: "c".repeat(40),
    version: "0.1.0-beta.134",
  };
  const logOrigin = "https://log-staging.example.test";
  const imageRun = { run_id: 11, run_attempt: 2 };
  const trustRun = {
    run_id: 12,
    run_attempt: 3,
    publisher_commit: "d".repeat(40),
  };
  const qualificationRun = { run_id: 13, run_attempt: 4 };
  const image = j({ ...source, publication: { runId: 11, runAttempt: 2 } });
  const inventory = j({
    schemaVersion: 1,
    kind: "mdbase-release-trust-bundle",
    ...source,
    publication: {
      runId: 12,
      runAttempt: 3,
      publisherCommit: trustRun.publisher_commit,
    },
    qualification: { runId: 13, runAttempt: 4 },
    imageBundle: {
      path: "image-release-bundle.json",
      length: image.length,
      sha256: digest(image),
      publicationRunId: 11,
      publicationRunAttempt: 2,
    },
    trustAssets: [
      {
        path: "next-trust/staging.json",
        length: asset.length,
        sha256: digest(asset),
        environment: "staging",
        controlPlaneOrigin: target.connectOrigin,
        logOrigin,
        source,
      },
    ],
  });
  const proofs = {
    "image-release-bundle.json": image,
    "image-release-bundle.sigstore.json": j({ fixture: "image signature" }),
    "release-trust-bundle.json": inventory,
    "release-trust-bundle.sigstore.json": j({ fixture: "trust signature" }),
  };
  const proof_sha256 = Object.fromEntries(
    Object.entries(proofs).map(([name, bytes]) => [name, digest(bytes)]),
  );
  const context = {
    schema_version: 1,
    kind: "mdbase-next-build-trust-context",
    context: {
      sha256: digest(asset),
      environment: "staging",
      control_plane_origin: target.connectOrigin,
      log_origin: logOrigin,
      source,
    },
    provenance: {
      asset_path: "next-trust/staging.json",
      asset_length: asset.length,
      proof_sha256,
      image_publication: imageRun,
      trust_publication: trustRun,
      publisher_qualification: qualificationRun,
    },
  };
  const contextRaw = j(context);
  const verifier = {
    sha256: digest("qualified verifier"),
    source: "e".repeat(40),
    clockOverride: false,
  };
  const receipt = j({
    schema: "mdbn-sdk/application-build/1",
    contextSha256: digest(contextRaw),
    verifierSha256: verifier.sha256,
    verifierSourceCommit: verifier.source,
  });
  const runtime = Buffer.from("original native wasm");
  const sqlite = Buffer.from("sqlite wasm");
  const init = Buffer.from("sqlite js");
  const provenance = {
    schema: "mdbn-sdk/application-assets/1",
    environment: "staging",
    trust: {
      environment: "staging",
      cpOrigin: target.connectOrigin,
      logOrigin,
      sha256: digest(asset),
      sourceCommit: source.commit,
      sourceVersion: source.version,
    },
    handoff: {
      ...context.provenance,
      contextSha256: digest(contextRaw),
      receiptSha256: digest(receipt),
    },
    verifier,
    runtime: {
      sha256: digest(runtime),
      bytes: runtime.length,
      maxBytes: runtime.length,
      source: { repository: "mdbase-dev/mdbase-next", commit: "a".repeat(40) },
      qualification: "fixture",
    },
    sqlite: {
      sha256: digest(sqlite),
      bytes: sqlite.length,
      maxBytes: 1024,
      initializer: { sha256: digest(init), bytes: init.length },
      package: "@sqlite.org/sqlite-wasm",
      version: "3.53.4-build2",
      qualification: "fixture",
    },
  };
  const module = Buffer.from(
    `const metadata = ${JSON.stringify({ schema: "mdbn-app-trust/release/1", environment: "staging", cpOrigin: target.connectOrigin, logOrigin, assetSha256: digest(asset), source })};\n`,
  );
  const protocolMembers = [
    ["package.json", j({ name: "@mdbase-dev/connect-protocol" })],
    ["dist/protocol.js", Buffer.from("original protocol JS")],
  ];
  const protocolBytes = tar(
    protocolMembers.map(([path, bytes]) => ["package/" + path, bytes]),
  );
  const originalMembers = {
    protocol: protocolMembers,
    ui: [
      ["package.json", j({ name: "@mdbase-dev/ui" })],
      ["dist/ui.js", Buffer.from("original UI")],
    ],
    sdk: [
      ["package.json", j({ name: "@mdbase-dev/sdk" })],
      ["dist/native/provenance.json", j(provenance)],
      ["dist/application/packaged-trust.js", module],
      ["dist/native/runtime.wasm", runtime],
      ["dist/native/sqlite3.wasm", sqlite],
      ["dist/native/sqlite3.js", init],
      [
        "dist/offline-shell-worker.js",
        Buffer.from("// original shell runtime"),
      ],
      ["vendor/protocol-original.tgz", protocolBytes],
      ...protocolMembers.map(([path, bytes]) => [
        "node_modules/@mdbase-dev/connect-protocol/" + path,
        bytes,
      ]),
    ],
  };
  const config = {
    environment: "staging",
    logOrigin,
    assetSha256: digest(asset),
    verifier,
    runtime: provenance.runtime,
    sqlite: provenance.sqlite,
    image_publication: imageRun,
    trust_publication: trustRun,
    publisher_qualification: qualificationRun,
    archives: {},
  };
  const dependencies = {};
  const approvedHashes = { asset: digest(asset) };
  for (const key of ["sdk", "ui", "protocol"]) {
    const name = {
      sdk: "@mdbase-dev/sdk",
      ui: "@mdbase-dev/ui",
      protocol: "@mdbase-dev/connect-protocol",
    }[key];
    const archive = `${key}-original.tgz`;
    const bytes = tar(
      originalMembers[key].map(([path, data]) => ["package/" + path, data]),
    );
    await put(`vendor/${archive}`, bytes);
    const expected = {
      archive,
      bytes: bytes.length,
      sha256: digest(bytes),
      sri: sri(bytes),
      source: "a".repeat(40),
      sourceTree: "b".repeat(40),
      ...(key === "sdk"
        ? { facts: "sdk/artifact-facts.json", members: "sdk/members.json" }
        : {
            members: originalMembers[key].map(([path, data]) => ({
              path,
              bytes: data.length,
              sha256: digest(data),
            })),
          }),
      ...(key === "ui" ? { companion: "ui/companion.json" } : {}),
    };
    config.archives[key] = expected;
    dependencies[name] = `file:vendor/${archive}`;
    approvedHashes[key] = expected.sha256;
    const facts = { ...expected, members: originalMembers[key].length };
    if (key === "sdk")
      Object.assign(facts, {
        nativeSource: provenance.runtime.source.commit,
        nativeSha256: provenance.runtime.sha256,
        nativeBytes: runtime.length,
        dependencies: [
          {
            name: "@mdbase-dev/connect-protocol",
            file: "vendor/protocol-original.tgz",
            bytes: protocolBytes.length,
            sha256: digest(protocolBytes),
            sri: sri(protocolBytes),
          },
        ],
      });
    if (key === "sdk") {
      await pput(expected.facts, j(facts));
      expected.factsSha256 = digest(j(facts));
      await pput(
        expected.members,
        j(
          originalMembers[key].map(([path, data]) => ({
            path,
            bytes: data.length,
            sha256: digest(data),
          })),
        ),
      );
    }
    if (key === "ui") {
      const companion = j({
        artifact: archive,
        bytes: bytes.length,
        sha256: digest(bytes),
        integrity: sri(bytes),
        sourceCommit: expected.source,
        pairedSdkSource: "a".repeat(40),
      });
      await pput(expected.companion, companion);
      expected.companionSha256 = digest(companion);
    }
    const store = join(root, "node_modules/.pnpm", key, "node_modules", name);
    for (const [path, data] of originalMembers[key]) {
      await mkdir(join(store, path, ".."), { recursive: true });
      await writeFile(join(store, path), data);
    }
    await mkdir(join(root, "node_modules/@mdbase-dev"), { recursive: true });
    await symlink(store, join(root, "node_modules", name));
  }
  await put("package.json", j({ dependencies }));
  await put(
    "pnpm-lock.yaml",
    Object.values(config.archives)
      .map(
        (a) =>
          `resolution: {integrity: ${a.sri}, tarball: file:vendor/${a.archive}}`,
      )
      .join("\n"),
  );
  config.lockSha256 = digest(await readFile(join(root, "pnpm-lock.yaml")));
  for (const [path, data] of Object.entries({
    ...proofs,
    "next-trust/staging.json": asset,
    "next-trust/staging-context.json": contextRaw,
    "sdk-build-receipt.json": receipt,
    "provenance.json": j(provenance),
  }))
    await pput(path, data);
  const save = async () => {
    config.packetFiles = await inventoryDirectory(packet);
    await put("config/native-publish/staging.json", j(config));
  };
  await save();
  return { root, config, save, put, pput, approvedHashes, originalMembers };
}

test("canonical full original packet + EVERY installed SDK/UI/protocol member and all four protected hashes bind", async (t) => {
  const f = await fixture(t);
  const result = await verifyTargetIntake({ ...f, target, installed: true });
  assert.equal(result.sdk.trust.sha256, f.approvedHashes.asset);
  assert.notEqual(result.sdk.trust.packagedTrustSha256, f.approvedHashes.asset);
  assert.equal(result.provenance.handoff.asset_path, "next-trust/staging.json");
});
for (const key of ["sdk", "ui", "protocol", "asset"])
  test(`protected ${key} missing or altered refuses despite otherwise matching originals`, async (t) => {
    const f = await fixture(t);
    for (const value of [undefined, "f".repeat(64)])
      await assert.rejects(
        verifyTargetIntake({
          ...f,
          target,
          approvedHashes: { ...f.approvedHashes, [key]: value },
          installed: true,
        }),
        /protected/,
      );
  });
for (const path of [
  "sdk/dist/native/runtime.wasm",
  "sdk/dist/application/packaged-trust.js",
  "sdk/node_modules/@mdbase-dev/connect-protocol/dist/protocol.js",
  "ui/dist/ui.js",
  "protocol/dist/protocol.js",
])
  test(`installed original tamper refuses before SDK execution: ${path}`, async (t) => {
    const f = await fixture(t);
    const [key, ...parts] = path.split("/");
    const name = {
      sdk: "@mdbase-dev/sdk",
      ui: "@mdbase-dev/ui",
      protocol: "@mdbase-dev/connect-protocol",
    }[key];
    await f.put(
      `node_modules/.pnpm/${key}/node_modules/${name}/${parts.join("/")}`,
      "tampered",
    );
    await assert.rejects(
      verifyTargetIntake({ ...f, target, installed: true }),
      /inventory-mismatch/,
    );
  });
for (const change of ["extra", "missing", "symlink"])
  test(`installed member ${change} refuses`, async (t) => {
    const f = await fixture(t);
    const path = join(
      f.root,
      "node_modules/.pnpm/ui/node_modules/@mdbase-dev/ui/dist/ui.js",
    );
    if (change === "extra")
      await f.put(
        "node_modules/.pnpm/ui/node_modules/@mdbase-dev/ui/extra.js",
        "x",
      );
    else {
      await rm(path);
      if (change === "symlink") await symlink("../package.json", path);
    }
    await assert.rejects(
      verifyTargetIntake({ ...f, target, installed: true }),
      /inventory-mismatch|symlink/,
    );
  });
test("Co064253 historical UI metadata stays intact but does not veto STAGING pinned originals", async (t) => {
  for (const change of [
    { noPublication: true },
    { pairedSdkSource: "f".repeat(40) },
  ]) {
    const f = await fixture(t);
    const path = f.config.archives.ui.companion;
    const facts = JSON.parse(
      await readFile(join(f.root, "vendor/native-publish/staging", path)),
    );
    const revised = j({ ...facts, ...change });
    await f.pput(path, revised);
    f.config.archives.ui.companionSha256 = digest(revised);
    await f.save();
    const result = await verifyTargetIntake({ ...f, target });
    assert.deepEqual(result.publicationConstraints, []);
    assert.equal(
      result.historicalUiQualification.noPublication,
      facts.noPublication === undefined && change.noPublication === undefined
        ? undefined
        : (change.noPublication ?? facts.noPublication),
    );
    assert.equal(
      result.historicalUiQualification.pairedSdkSource,
      change.pairedSdkSource ?? facts.pairedSdkSource,
    );
  }
});

test("Co064253 does not waive wrong UI pin despite historical labels", async (t) => {
  const f = await fixture(t);
  const pkg = JSON.parse(await readFile(join(f.root, "package.json")));
  pkg.dependencies["@mdbase-dev/ui"] = "file:vendor/unapproved-ui.tgz";
  await f.put("package.json", j(pkg));
  await assert.rejects(verifyTargetIntake({ ...f, target }), /original pin/);
});

test("candidate can NOT replace packet facts/member inventory and expected digests together", async (t) => {
  const f = await fixture(t);
  await f.pput("sdk/artifact-facts.json", j({ source: "replacement" }));
  await assert.rejects(
    verifyTargetIntake({ ...f, target }),
    /inventory-mismatch/,
  );
});
test("frozen lock edit, archive replacement, wrong target and module/context/receipt-as-ASSET refuse", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    verifyTargetIntake({ ...f, target: NATIVE_PUBLISH_TARGETS.production }),
    /Missing actual reviewed target/,
  );
  for (const wrong of [digest("module"), digest("context"), digest("receipt")])
    await assert.rejects(
      verifyTargetIntake({
        ...f,
        target,
        approvedHashes: { ...f.approvedHashes, asset: wrong },
      }),
      /protected raw trust ASSET/,
    );
  await f.put("pnpm-lock.yaml", "edited lock");
  await assert.rejects(verifyTargetIntake({ ...f, target }), /Frozen lock/);
});
test("even reviewed packet labels cannot retarget original SDK, proof, context or raw asset", async (t) => {
  for (const path of [
    "next-trust/staging.json",
    "next-trust/staging-context.json",
    "provenance.json",
    "release-trust-bundle.sigstore.json",
    "sdk-build-receipt.json",
  ]) {
    const f = await fixture(t);
    await f.pput(
      path,
      j({ environment: "staging", sha256: f.approvedHashes.asset }),
    );
    await f.save();
    await assert.rejects(verifyTargetIntake({ ...f, target }));
  }
});
test("LAB/production UI or SDK metadata and self-asserted authority cannot replace genuine staging originals", async (t) => {
  const f = await fixture(t);
  f.config.environment = "lab";
  await f.save();
  await assert.rejects(verifyTargetIntake({ ...f, target }), /environment/);
});
test("parser reads actual pinned SDK originals without execution (NOT target qualification)", async () => {
  const members = readNpmArchive(
    await readFile(new URL("../vendor/sdk-dev-cc492f3f.tgz", import.meta.url)),
  );
  assert.ok(members.size > 800);
  assert.ok(members.has("dist/application/packaged-trust.js"));
});
for (const entries of [
  [["package/../escape", "x"]],
  [
    ["package/x", "x"],
    ["package/x", "y"],
  ],
  [["package/link", "x", "2"]],
  [["package/file", "x", "1"]],
  [
    ["package/dir", "x"],
    ["package/dir/file", "y"],
  ],
])
  test("tar traversal/duplicates/links/file-directory ambiguity refuse", () => {
    assert.throws(() => readNpmArchive(tar(entries)));
  });
