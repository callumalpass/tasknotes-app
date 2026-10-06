import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);

test("combined development getter/timers pins all actual archives in one graph", async () => {
  const provenance = JSON.parse(
    await readFile(
      new URL("vendor/mdbase-dev-control-timers-305ad941-5ff45292.json", root),
      "utf8",
    ),
  );
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const lock = await readFile(new URL("pnpm-lock.yaml", root), "utf8");
  assert.equal(
    provenance.purpose,
    "isolated development source/type integration only",
  );
  assert.equal(provenance.releaseQualified, false);
  assert.deepEqual(provenance.sources, {
    connectComposition: "305ad941d3b20188715ab6a1043274fe2fe07737",
    connectBase: "c9bf0cf4ced7d8f4f4402409df706eb5887068c1",
    getter: "23ac9d061a01d062b4197ae424d1dfd4c96d3771",
    timerFactory: "e5d948bd66d7a4718b1e0be0a41c3179a6e16230",
    sdkComposition: "5ff4529250aa62f695ddeebee5f9007ab906d007",
    sdkBridgeBase: "d81ff8614ed95695368452f2e2d404f369f3840c",
    sdkTimerFacade: "fbe42a22cd59f745484c3fc028f1843dc7509c6a",
  });
  assert.deepEqual(provenance.artifacts.map((a) => a.package).sort(), [
    "@mdbase-dev/connect",
    "@mdbase-dev/connect-protocol",
    "@mdbase-dev/sdk",
  ]);
  for (const artifact of provenance.artifacts) {
    const bytes = await readFile(new URL(`vendor/${artifact.file}`, root));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      artifact.sha256,
    );
    assert.equal(
      pkg.dependencies[artifact.package],
      `file:vendor/${artifact.file}`,
    );
    assert.equal(
      pkg.pnpm.overrides[artifact.package],
      pkg.dependencies[artifact.package],
    );
    assert.ok(
      lock.includes(
        `integrity: sha512-${createHash("sha512").update(bytes).digest("base64")}`,
      ),
    );
  }
});
