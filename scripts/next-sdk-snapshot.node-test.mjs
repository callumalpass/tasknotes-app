import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);

test("vendored next SDK has exact revision, artifact hashes and dependency pin", async () => {
  const provenance = JSON.parse(
    await readFile(
      new URL("vendor/mdbase-dev-sdk-0.0.0-d81ff861.json", root),
      "utf8",
    ),
  );
  const bytes = await readFile(new URL(`vendor/${provenance.artifact}`, root));
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.equal(
    provenance.sourceCommit,
    "d81ff8614ed95695368452f2e2d404f369f3840c",
  );
  assert.equal(
    pkg.dependencies[provenance.package],
    `file:vendor/${provenance.artifact}`,
  );
  assert.equal(bytes.length, provenance.bytes);
  for (const algorithm of ["sha256", "sha512"])
    assert.equal(
      createHash(algorithm).update(bytes).digest("hex"),
      provenance[algorithm],
    );
});
