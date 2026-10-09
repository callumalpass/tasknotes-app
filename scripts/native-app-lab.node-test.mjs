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
    "c59379cbf99c2f9c1fbfa4729c69d497ddff68aadce97daac768fc38fb136b9e",
  );
  assert.equal(
    pin.runtimeSource.commit,
    "93ff332cf6cb21e85ef0dcb8987fa73c6599f6c7",
  );
  assert.equal(sha(`vendor/${pin.trustModule}`), pin.trustModuleSha256);
  assert.equal(sha(`vendor/${pin.runtime}`), pin.runtimeSha256);
});
