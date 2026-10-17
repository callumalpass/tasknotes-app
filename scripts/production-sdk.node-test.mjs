import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertProductionSdk,
  checkProductionSdk,
  PRODUCTION_SDK_REQUIRED,
} from "./production-sdk.mjs";

test("production refuses absent and LAB trust, without calling any asset loader", () => {
  for (const release of [null, { environment: "lab" }]) {
    assert.throws(
      () =>
        assertProductionSdk(release, () =>
          assert.fail("must not select assets"),
        ),
      { message: PRODUCTION_SDK_REQUIRED },
    );
  }
});
test("production checks both web and iOS against the same SDK artifact", () => {
  const origins = [];
  assertProductionSdk(
    { environment: "production", cpOrigin: "https://connect.mdbase.dev" },
    (environment, origin) => {
      origins.push(origin);
      assert.equal(environment, "production");
      return { release: () => ({ environment }) };
    },
  );
  assert.deepEqual(origins, [
    "https://app.tasknotes.dev",
    "capacitor://app.tasknotes.dev",
  ]);
});
test("production never accepts a LAB asset fallback", () => {
  assert.throws(
    () =>
      assertProductionSdk(
        { environment: "production", cpOrigin: "https://connect.mdbase.dev" },
        () => ({ release: () => ({ environment: "lab" }) }),
      ),
    { message: PRODUCTION_SDK_REQUIRED },
  );
});
test("current pinned SDK stays explicitly blocked pending authenticated production release", async () => {
  await assert.rejects(checkProductionSdk(), {
    message: PRODUCTION_SDK_REQUIRED,
  });
});
