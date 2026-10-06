import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);

test("composed development SDK (clients-dev 331fccb9) with the retained Connect graph pins all archives", async () => {
  const provenance = JSON.parse(
    await readFile(
      new URL("vendor/mdbase-dev-clients-dev-331fccb9.json", root),
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
    connectRecovery: "95431115fbc5c12ae4ff83c8e2a14fd9dfbe843c",
    sdkComposition: "331fccb9 (ws/clients-dev-20261006 on main 7115b748)",
    sdkMembers: {
      "#327": "7f457272",
      "#366": "9306bf8a",
      "#390": "84cb43c4",
      "#395": "aff43741",
      "#400": "706a1a71",
      "timer-checkpoint": "1fff217b",
    },
    delivery: ".coord/sdk-tnapp-artifacts/clients-dev-331fccb9/provenance.json",
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
