import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
const root = new URL("../", import.meta.url);
const sha = (path) =>
  createHash("sha256")
    .update(readFileSync(new URL(path, root)))
    .digest("hex");
test("isolated LAB native bundle retains immutable verified context and runtime pins", () => {
  const pin = JSON.parse(
    readFileSync(new URL("vendor/native-app-lab.json", root), "utf8"),
  );
  assert.equal(pin.environment, "lab");
  assert.equal(pin.appOrigin, "http://127.0.0.1:48218");
  assert.equal(
    pin.trustModuleSha256,
    "a7db2cc3ba9fd1e78d86093599b608a2e3268408402630d81242450603c98a10",
  );
  assert.equal(
    pin.runtimeSha256,
    "e31916f5ca96c1a8e220b7ef7aa67a8d20c26945f1ffb78f7108d9c9a79636e2",
  );
  assert.equal(sha(`vendor/${pin.trustModule}`), pin.trustModuleSha256);
  assert.equal(sha(`vendor/${pin.runtime}`), pin.runtimeSha256);
});
