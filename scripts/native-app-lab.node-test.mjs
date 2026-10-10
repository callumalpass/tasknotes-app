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
    "4951032520a7e149a8ac58485d09d67bb5e2971e26e46cb946b0dd3860b06809",
  );
  assert.equal(
    pin.runtimeSource.commit,
    "cb4fd6142947958c4123a59dce994de47a153b98",
  );
  assert.equal(sha(`vendor/${pin.trustModule}`), pin.trustModuleSha256);
  assert.equal(sha(`vendor/${pin.runtime}`), pin.runtimeSha256);
});
