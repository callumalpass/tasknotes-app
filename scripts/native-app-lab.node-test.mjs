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
    "5f1ea5b2ab8809794ea6da8ef8609e53651551716a57309bfa628c44f497ddf2",
  );
  assert.equal(
    pin.runtimeSource.commit,
    "6f7b28fc39a58ef08e083d71407c9e28a8ed0e7f",
  );
  assert.equal(sha(`vendor/${pin.trustModule}`), pin.trustModuleSha256);
  assert.equal(sha(`vendor/${pin.runtime}`), pin.runtimeSha256);
});
