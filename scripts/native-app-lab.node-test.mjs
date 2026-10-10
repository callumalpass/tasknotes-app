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
    "58e9ed23146a956af24b936359fc79c931873eda1c8d9e297f5196f02ddaa265",
  );
  assert.equal(
    pin.runtimeSource.commit,
    "d70c9487db12fc864fd68ea8b8d26586d12276fa",
  );
  assert.equal(sha(`vendor/${pin.trustModule}`), pin.trustModuleSha256);
  assert.equal(sha(`vendor/${pin.runtime}`), pin.runtimeSha256);
});
