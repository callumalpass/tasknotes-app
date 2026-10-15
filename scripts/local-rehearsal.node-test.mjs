import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { resolve } from "node:path";
import { readLocalSdkReceipt, prepareLocalSdk } from "./local-sdk.mjs";

function fixture(run) {
  const parent = resolve(".artifacts/local-sdk-input-tests");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(resolve(parent, "input-"));
  mkdirSync(resolve(root, "vendor"));
  const receipt = {
    schema: "tasknotes/local-sdk-build/1",
    sourceCommit: "a".repeat(40),
    archive: "vendor/sdk-local-example.tgz",
    archiveSha256: "b".repeat(64),
    trustAssetSha256: "c".repeat(64),
    runtimeSha256: "d".repeat(64),
  };
  const save = (value) =>
    writeFileSync(
      resolve(root, "vendor/local-sdk-input.json"),
      JSON.stringify(value),
    );
  try {
    run({ root, receipt, save });
  } finally {
    rmSync(root, { recursive: true });
  }
}

test("public local receipt has exact immutable qualified fields", () =>
  fixture(({ root, receipt, save }) => {
    save(receipt);
    assert.deepEqual(readLocalSdkReceipt(root), receipt);
    assert.equal(Object.isFrozen(readLocalSdkReceipt(root)), true);
  }));

test("refuses traversal, non-string fields and malformed source/hash receipt", () =>
  fixture(({ root, receipt, save }) => {
    for (const value of [
      null,
      [],
      { ...receipt, archive: "../outside.tgz" },
      { ...receipt, archive: [receipt.archive] },
      { ...receipt, sourceCommit: "unqualified" },
      { ...receipt, sourceCommit: [receipt.sourceCommit] },
      { ...receipt, trustAssetSha256: "bad" },
      { ...receipt, runtimeSha256: null },
    ]) {
      save(value);
      assert.throws(
        () => readLocalSdkReceipt(root),
        /Local SDK public build receipt refused/,
      );
    }
  }));

test("tampered archive is refused before extraction or dependency lookup", () =>
  fixture(({ root, receipt, save }) => {
    save(receipt);
    writeFileSync(
      resolve(root, receipt.archive),
      "not the qualified SDK archive",
    );
    assert.throws(
      () => prepareLocalSdk(root),
      /Local SDK archive qualification refused/,
    );
    assert.equal(existsSync(resolve(root, ".local-rehearsal-sdk")), false);
  }));
