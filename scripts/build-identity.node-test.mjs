import assert from "node:assert/strict";
import test from "node:test";
import { buildIdentity } from "./build-identity.ts";

const SOURCE = "602fa92ec588d1e6f829c5c930a3962a2f5dd3ba";

test("a store build names its store version and exact source (#492)", () => {
  assert.deepEqual(
    buildIdentity("1.0.12", {
      TASKNOTES_STORE_VERSION: "1.0.45",
      TASKNOTES_STORE_SOURCE: SOURCE,
    }),
    { version: "1.0.45", commit: SOURCE, revision: "1.0.45-602fa92ec588" },
  );
});

test("a web publish keeps the package version and names its commit", () => {
  assert.deepEqual(
    buildIdentity("1.0.12", { TASKNOTES_BUILD_COMMIT: SOURCE }),
    { version: "1.0.12", commit: SOURCE, revision: "1.0.12-602fa92ec588" },
  );
});

test("a local build is the package version alone", () => {
  assert.deepEqual(buildIdentity("1.0.12", {}), {
    version: "1.0.12",
    commit: null,
    revision: "1.0.12",
  });
});

test("malformed versions and commits are never shown", () => {
  assert.deepEqual(
    buildIdentity("1.0.12", {
      TASKNOTES_STORE_VERSION: "1.0.45; rm",
      TASKNOTES_BUILD_COMMIT: "main",
      TASKNOTES_STORE_SOURCE: "602fa92e",
    }),
    { version: "1.0.12", commit: null, revision: "1.0.12" },
  );
});

test("an invalid build commit falls through to a valid store source", () => {
  assert.equal(
    buildIdentity("1.0.12", {
      TASKNOTES_BUILD_COMMIT: "",
      TASKNOTES_STORE_SOURCE: SOURCE,
    }).commit,
    SOURCE,
  );
});
