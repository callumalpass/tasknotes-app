import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { loadOriginals, productionPin } from "./originals.mjs";
import { prepareInstall } from "./install-inputs.mjs";
const root = new URL("../../", import.meta.url).pathname;
it("authenticates production npm provenance, protected raw trust and ALL installed frozen originals", async () => {
  const policy = JSON.parse(
    await readFile(join(root, "config/sdk-publication.json"), "utf8"),
  ).sdkPublication;
  const trust = await loadOriginals({
    target: "production",
    repoRoot: root,
    hashes: {
      TASKNOTES_TRUST_ASSET_SHA256: policy.environments.production.sha256,
    },
    installed: true,
  });
  const { pin } = await productionPin(root);
  assert.equal(trust.authentication.source, pin.sourceCommit);
  assert.equal(trust.authentication.kind, "npm-provenance");
  assert.ok(
    Object.values(trust.archives).some(
      (a) => a.name === "@mdbase-dev/connect-protocol",
    ),
  );
  assert.ok(Object.values(trust.archives).some((a) => a.name === "mdbase"));
});
it("derives frozen staging SDK and all UI peer resolutions without touching other dependencies or originals", async () => {
  const { pin, spec } = await productionPin(root),
    lock = await readFile(join(root, "pnpm-lock.yaml"), "utf8");
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const bytes = Buffer.from("authenticated staging archive fixture");
  const sdk = {
    path: "https://example.invalid/staging",
    sha256: hash(bytes),
    sri: "sha512-fixture",
  };
  const sdkTrust = {
    archives: { sdk },
    production: { path: spec.slice(5), sri: pin.sri, version: pin.version },
    lockSha256: hash(lock),
  };
  const temp = await mkdtemp(join(tmpdir(), "tasknotes-stage-install-"));
  try {
    await mkdir(join(temp, "vendor"));
    for (const path of ["package.json", "pnpm-lock.yaml"])
      await cp(join(root, path), join(temp, path));
    const before = JSON.parse(
      await readFile(join(temp, "package.json"), "utf8"),
    );
    await prepareInstall(
      { target: "staging", sdkTrust },
      temp,
      async () => new Response(bytes),
    );
    const after = JSON.parse(
      await readFile(join(temp, "package.json"), "utf8"),
    );
    assert.equal(
      after.dependencies["@mdbase-dev/sdk"],
      "file:vendor/sdk-staging.tgz",
    );
    after.dependencies["@mdbase-dev/sdk"] =
      before.dependencies["@mdbase-dev/sdk"];
    assert.deepEqual(after, before);
    const staged = await readFile(join(temp, "pnpm-lock.yaml"), "utf8");
    assert.ok(!staged.includes(spec));
    assert.ok(staged.includes(sdk.sri));
    assert.equal(
      staged
        .replaceAll(
          "@mdbase-dev/sdk-staging@file:vendor/sdk-staging.tgz",
          "@mdbase-dev/sdk@" + spec,
        )
        .replaceAll("file:vendor/sdk-staging.tgz", spec)
        .replace("    name: '@mdbase-dev/sdk-staging'\n", "")
        .replace(sdk.sri, pin.sri)
        .replaceAll(
          "version: '@mdbase-dev/sdk@" + spec + "'",
          "version: " + spec,
        )
        .replaceAll(
          "'@mdbase-dev/sdk': '@mdbase-dev/sdk@" + spec + "'",
          "'@mdbase-dev/sdk': " + spec,
        ),
      lock,
    );
    await assert.rejects(
      prepareInstall(
        { target: "staging", sdkTrust },
        temp,
        async () => new Response("wrong"),
      ),
      /Staging original changed/,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
