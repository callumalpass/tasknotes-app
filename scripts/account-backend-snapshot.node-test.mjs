import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);

test("development account getter pins both actual archives and one Connect graph", async () => {
  const provenance = JSON.parse(
    await readFile(
      new URL("vendor/mdbase-dev-connect-getter-3f2b9cd9.json", root),
      "utf8",
    ),
  );
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const lock = await readFile(new URL("pnpm-lock.yaml", root), "utf8");
  assert.equal(
    provenance.sourceHead,
    "3f2b9cd920e036221457c2e0c370b4e258aaea7c",
  );
  assert.equal(
    provenance.receiverHead,
    "568dd23d06fefbcc46da9b7cc0ed915fe921dc4e",
  );
  assert.equal(
    provenance.purpose,
    "isolated development source/type integration only",
  );
  assert.equal(provenance.artifacts.length, 2);
  for (const artifact of provenance.artifacts) {
    const name = artifact.sourceFile.startsWith("mdbase-dev-connect-protocol-")
      ? "@mdbase-dev/connect-protocol"
      : "@mdbase-dev/connect";
    const bytes = await readFile(new URL(`vendor/${artifact.file}`, root));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      artifact.sha256,
    );
    assert.equal(pkg.dependencies[name], `file:vendor/${artifact.file}`);
    assert.equal(pkg.pnpm.overrides[name], pkg.dependencies[name]);
    assert.ok(
      lock.includes(
        `integrity: sha512-${createHash("sha512").update(bytes).digest("base64")}`,
      ),
    );
  }
});
