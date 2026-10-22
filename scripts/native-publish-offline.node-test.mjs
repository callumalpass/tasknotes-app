import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  parseEmbeddedOfflineShell,
  assertOfflineShell,
  originalOfflineRuntime,
} from "./lib/native-offline-shell.mjs";
import { inventoryDirectory } from "./lib/native-publish-bytes.mjs";
import { encodeOfflineShell } from "./fixtures/offline-shell-data.mjs";
const hash = (b) => createHash("sha256").update(b).digest("hex");
const entries = () => [
  { path: "index.html", sha256: hash("index") },
  { path: "mdbase-shell-runtime.js", sha256: hash("// runtime") },
];
test("canonical embedded SDK JSON is parsed as DATA, version binds prefix + cache list", () => {
  const parsed = parseEmbeddedOfflineShell(encodeOfflineShell(entries()));
  assert.equal(parsed.base, "/");
  assert.deepEqual(parsed.assets, entries());
});
const invalidEntries = [
  ["absolute", (a) => (a[0].path = "https://attacker.invalid/index.html")],
  ["scheme-relative", (a) => (a[0].path = "//attacker.invalid/index.html")],
  ["parent", (a) => (a[0].path = "../index.html")],
  ["percent-alias", (a) => (a[0].path = "%69ndex.html")],
  ["query", (a) => (a[0].path = "index.html?x=1")],
  ["fragment", (a) => (a[0].path = "index.html#x")],
  ["backslash", (a) => (a[0].path = "x\\index.html")],
  ["dot-member", (a) => (a[0].path = ".well-known/app.json")],
  ["underscore-member", (a) => (a[0].path = "_headers")],
  [
    "worker-self",
    (a) => a.push({ path: "service-worker.js", sha256: hash("x") }),
  ],
  ["duplicate", (a) => a.push({ ...a[0] })],
  ["case-collision", (a) => a.unshift({ ...a[0], path: "INDEX.HTML" })],
  ["missing-index", (a) => a.shift()],
  ["missing-runtime", (a) => a.pop()],
  ["unsorted", (a) => a.reverse()],
  ["bad-hash", (a) => (a[0].sha256 = "F".repeat(64))],
  ["extra-property", (a) => (a[0].unreviewed = true)],
  ["overlong-path", (a) => (a[0].path = "x".repeat(1100) + ".html")],
  [
    "count-bound",
    (a) => {
      while (a.length <= 4096) a.push({ ...a[0] });
    },
  ],
];
for (const [label, mutate] of invalidEntries)
  test(`offline manifest rejects ${label}`, () => {
    const a = entries();
    mutate(a);
    assert.throws(() => parseEmbeddedOfflineShell(encodeOfflineShell(a)));
  });
for (const [label, change] of [
  [
    "duplicate-JSON-key",
    (s) => s.replace('"base":"/"', '"base":"/","base":"/"'),
  ],
  ["noncanonical-escape", (s) => s.replace("index.html", "\\u0069ndex.html")],
  ["noncanonical-whitespace", (s) => s.replace('"base":"/"', '"base": "/"')],
  [
    "wrong-version",
    (s) =>
      s.replace(
        /"version":"[a-f0-9]{64}"/,
        '"version":"' + "0".repeat(64) + '"',
      ),
  ],
  ["altered-prefix", (s) => s.replace("// unit worker", "// changed worker")],
  [
    "foreign-runtime-import",
    (s) =>
      s.replace(
        "./mdbase-shell-runtime.js",
        "https://attacker.invalid/runtime.js",
      ),
  ],
  ["trailing-execution", (s) => s + 'fetch("https://attacker.invalid");'],
  ["duplicate-marker", (s) => "\n// mdbase shared offline shell\n" + s],
  [
    "missing-marker",
    (s) => s.replace("// mdbase shared offline shell", "// missing"),
  ],
  ["BOM", (s) => "\ufeff" + s],
])
  test(`embedded shell rejects ${label} without execution`, () =>
    assert.throws(() =>
      parseEmbeddedOfflineShell(
        Buffer.from(change(encodeOfflineShell(entries()).toString())),
      ),
    ));
test("offline bounds, invalid UTF8, foreign base and original runtime binding refuse", () => {
  assert.throws(() =>
    parseEmbeddedOfflineShell(Buffer.alloc(2 * 1024 * 1024 + 1)),
  );
  assert.throws(() => parseEmbeddedOfflineShell(Buffer.from([0xff])));
  assert.throws(() =>
    parseEmbeddedOfflineShell(
      encodeOfflineShell(entries(), "", "https://attacker.invalid/"),
    ),
  );
  assert.throws(() => originalOfflineRuntime(undefined));
  const raw = Buffer.from("// runtime\n//# sourceMappingURL=unit.js.map");
  const expected = originalOfflineRuntime(raw);
  assert.equal(expected.sha256, hash("// runtime"));
  assert.equal(expected.originalSourceSha256, hash(raw));
});
test("every cached hash matches actual full inventory; non-cache hidden/control/unlisted bytes stay bound", async (t) => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "tn-offline-")),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = {
    "index.html": "index",
    "mdbase-shell-runtime.js": "// runtime",
    ".nojekyll": "\n",
    _headers: "policy",
    ".well-known/app.json": "{}",
    "unlisted.bin": "extra",
    "service-worker.js": encodeOfflineShell(entries()),
  };
  for (const [p, b] of Object.entries(files)) {
    await mkdir(join(directory, p, ".."), { recursive: true });
    await writeFile(join(directory, p), b);
  }
  const sdkTrust = {
    sdk: { offlineShell: originalOfflineRuntime(Buffer.from("// runtime")) },
  };
  const assets = await inventoryDirectory(directory);
  assert.equal(
    (await assertOfflineShell({ directory, assets, sdkTrust })).assets.length,
    2,
  );
  assert.equal(assets.length, 7);
  await assert.rejects(
    assertOfflineShell({
      directory,
      assets,
      sdkTrust: {
        sdk: {
          offlineShell: { ...sdkTrust.sdk.offlineShell, sha256: hash("other") },
        },
      },
    }),
    /ORIGINAL/,
  );
  await writeFile(join(directory, "index.html"), "tampered");
  await assert.rejects(
    assertOfflineShell({
      directory,
      assets: await inventoryDirectory(directory),
      sdkTrust,
    }),
    /asset hash/,
  );
  await writeFile(join(directory, "index.html"), "index");
  await writeFile(join(directory, "unlisted.bin"), "tampered");
  await assert.rejects(
    assertOfflineShell({ directory, assets, sdkTrust }),
    /inventory-mismatch/,
  );
});
