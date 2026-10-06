import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);

test("combined development getter/timer recovery/watch pins all actual archives in one graph", async () => {
  const provenance = JSON.parse(
    await readFile(
      new URL(
        "vendor/mdbase-dev-control-recovery-38f456ec-26abbb60.json",
        root,
      ),
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
    connectComposition: "38f456ec44304cd7cd880fafa139140e27eda271",
    connectBase: "c9bf0cf4ced7d8f4f4402409df706eb5887068c1",
    getter: "23ac9d061a01d062b4197ae424d1dfd4c96d3771",
    timerFactory: "7c2f20eab6f899ad9586395c856fc27f01379d3c",
    sdkComposition: "26abbb6030a52c8d69ca1b62a7d9d7febd8479e3",
    sdkBridgeBase: "d81ff8614ed95695368452f2e2d404f369f3840c",
    sdkTimerFacade: "fbe42a22cd59f745484c3fc028f1843dc7509c6a",
    sdkWatch: "b8e5bb47ebbd5b42cff844807bc0666adad5399a",
    connectRecovery: "95431115fbc5c12ae4ff83c8e2a14fd9dfbe843c",
    sdkRecovery: "5b690ec6e872fcfde1f549d2f31ee2e43d1717ef",
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
