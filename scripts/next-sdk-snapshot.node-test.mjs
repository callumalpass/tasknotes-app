import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);

test("combined development getter/timers/watch pins all actual archives in one graph", async () => {
  const provenance = JSON.parse(
    await readFile(
      new URL("vendor/mdbase-dev-control-watch-f578ed55-1f00edca.json", root),
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
    connectComposition: "f578ed555e49eab5e40667fb40e7b1f91af3b563",
    connectBase: "c9bf0cf4ced7d8f4f4402409df706eb5887068c1",
    getter: "23ac9d061a01d062b4197ae424d1dfd4c96d3771",
    timerFactory: "7c2f20eab6f899ad9586395c856fc27f01379d3c",
    sdkComposition: "1f00edca4692bc076433df03ce560233f59f4bf3",
    sdkBridgeBase: "d81ff8614ed95695368452f2e2d404f369f3840c",
    sdkTimerFacade: "fbe42a22cd59f745484c3fc028f1843dc7509c6a",
    sdkWatch: "b8e5bb47ebbd5b42cff844807bc0666adad5399a",
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
