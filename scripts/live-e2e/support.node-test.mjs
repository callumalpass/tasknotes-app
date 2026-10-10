import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  assertDisposableLocator,
  decodeCredentialPayload,
} from "./credentials.mjs";
import {
  assertReadiness,
  assertSingleBrowserPolicy,
  portableScratchpadId,
  evidenceRoot,
  expected,
  once,
  ownedPath,
  redact,
} from "./support.mjs";

const ready = () => ({
  ...expected,
  mode: "lab",
  source_clean: true,
  runtime_dist_vendor_qualified_http_equal: true,
  index_sha256: "abc",
  entry_resources: [{}],
});

test("source contains no hardcoded private provisioning directories", async () => {
  const directory = new URL("./", import.meta.url);
  for (const name of await readdir(directory)) {
    if (!name.endsWith(".mjs")) continue;
    const contents = await readFile(new URL(name, directory), "utf8");
    assert.doesNotMatch(contents, /mdbase-lab-provisioning\/release-/, name);
  }
});
test("accepts exact refreshed LAB identity", () => assertReadiness(ready()));
test("historical concurrent browser workflow is refused", () => {
  assertSingleBrowserPolicy(1);
  for (const count of [0, 2, undefined, "1"])
    assert.throws(() => assertSingleBrowserPolicy(count));
});
test("current scratchpad identity uses portable document prefix, not row ID", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  assert.equal(
    portableScratchpadId([`${id}:first-row`, `${id}:second-row`]),
    id,
  );
  for (const attributes of [
    [],
    [null],
    [id],
    ["scratchpad:historical"],
    [`${id}:row`, "00000000-0000-4000-8000-000000000002:row"],
  ])
    assert.throws(() => portableScratchpadId(attributes));
});
test("credential locator accepts only disposable LAB purpose with exact schema", () => {
  const key = {
    application: "synthetic",
    environment: "lab",
    fixture: "synthetic",
    purpose: "clients-disposable-signup",
  };
  assertDisposableLocator(key);
  assert.throws(() =>
    assertDisposableLocator({ ...key, environment: "production" }),
  );
  assert.throws(() =>
    assertDisposableLocator({ ...key, purpose: "lab-acceptance" }),
  );
  assert.throws(() =>
    assertDisposableLocator({ ...key, account: "synthetic" }),
  );
  assert.throws(() => assertDisposableLocator({ ...key, fixture: "" }));
});
test("credential payload decodes exact JSON and binds its email", () => {
  const payload = JSON.stringify({
    email: "synthetic@example.invalid",
    password: "synthetic-password",
  });
  assert.equal(
    decodeCredentialPayload(payload, "synthetic@example.invalid").password,
    "synthetic-password",
  );
  assert.throws(() =>
    decodeCredentialPayload(payload, "wrong@example.invalid"),
  );
  assert.throws(() =>
    decodeCredentialPayload("plain-password", "synthetic@example.invalid"),
  );
  assert.throws(() =>
    decodeCredentialPayload(
      JSON.stringify({ email: "synthetic@example.invalid", password: "" }),
      "synthetic@example.invalid",
    ),
  );
});
for (const key of Object.keys(expected)) {
  test(`rejects a different ${key}`, () =>
    assert.throws(() => assertReadiness({ ...ready(), [key]: "wrong" })));
}
test("rejects incomplete build proof", () => {
  for (const key of [
    "source_clean",
    "runtime_dist_vendor_qualified_http_equal",
  ])
    assert.throws(() => assertReadiness({ ...ready(), [key]: false }));
  assert.throws(() => assertReadiness({ ...ready(), mode: "production" }));
});
test("redacts email, identity, code, and credential-bearing URLs", () => {
  const result = redact(
    "test@example.invalid 00000000-0000-0000-0000-000000000001 123456 https://connect-lab.mdbase.dev/device?token=secret abcdefghijklmnopqrstuvwxyz012345",
  );
  assert.equal(
    result,
    "[email] [id] [code] https://connect-lab.mdbase.dev/[redacted-path] [opaque]",
  );
});
test("refuses paths outside its own evidence root", () => {
  assert.throws(() => ownedPath("/tmp/report.json"));
  assert.throws(() => ownedPath(`${evidenceRoot}/../other/report.json`));
  assert.equal(
    ownedPath(`${evidenceRoot}/safe/report.json`),
    `${evidenceRoot}/safe/report.json`,
  );
});
test("an unknown action outcome cannot be automatically retried", async () => {
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(evidenceRoot, "harness-test-"));
  let calls = 0;
  try {
    await assert.rejects(
      once(root, "create", async () => {
        calls++;
        throw Error("unknown");
      }),
    );
    await assert.rejects(
      once(root, "create", async () => {
        calls++;
      }),
    );
    assert.equal(calls, 1);
  } finally {
    await rm(root, { recursive: true });
  }
});
