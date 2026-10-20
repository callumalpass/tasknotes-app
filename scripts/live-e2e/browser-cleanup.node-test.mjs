import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertBrowserStopped,
  closeWithScopedCleanup,
} from "./browser-cleanup.mjs";

const options = { timeout: 1000 };
const failedClose = {
  close: async () => {
    throw Error("synthetic close failure");
  },
};
const never = () => new Promise(() => {});
function fakeCleanup(inspect, overrides = {}) {
  const signals = [],
    waits = [];
  return {
    signals,
    waits,
    dependencies: {
      inspect,
      stop: (pid, signal) => signals.push([pid, signal]),
      wait: async (ms) => {
        waits.push(ms);
      },
      deadline: never,
      ...overrides,
    },
  };
}
test(
  "resolved context close is positive shutdown, no process inspection",
  options,
  async () => {
    const fake = fakeCleanup(async () => {
      throw Error("must not inspect");
    });
    assert.equal(
      await closeWithScopedCleanup(
        { close: async () => {} },
        fake.dependencies,
      ),
      "stopped",
    );
    assert.deepEqual(fake.signals, []);
  },
);
test("scoped cleanup requires final positive absence", options, async () => {
  const snapshots = [[123], [123], []];
  const fake = fakeCleanup(async () => snapshots.shift());
  assert.equal(
    await closeWithScopedCleanup(failedClose, fake.dependencies),
    "stopped-after-scoped-cleanup",
  );
  assert.deepEqual(fake.signals, [
    [123, "SIGTERM"],
    [123, "SIGKILL"],
  ]);
  assert.deepEqual(fake.waits, [1500, 300]);
});
for (const failureAt of [0, 1, 2]) {
  test(
    `process inspection failure at stage ${failureAt} never means stopped`,
    options,
    async () => {
      let inspections = 0;
      const fake = fakeCleanup(async () => {
        if (inspections++ === failureAt)
          throw Error("synthetic ps failure/timeout");
        return [123];
      });
      const result = await closeWithScopedCleanup(
        failedClose,
        fake.dependencies,
      );
      assert.equal(result, "cleanup-blocked");
      assert.throws(() => assertBrowserStopped(result));
      assert.equal(inspections, failureAt + 1);
    },
  );
}
test("timed out close still refuses unknown cleanup", options, async () => {
  const fake = fakeCleanup(
    async () => {
      throw Error("synthetic inspection failure");
    },
    { deadline: async () => false },
  );
  assert.equal(
    await closeWithScopedCleanup({ close: never }, fake.dependencies),
    "cleanup-blocked",
  );
});
test(
  "signal permission failure is blocked; only already-gone ESRCH is harmless",
  options,
  async () => {
    const blocked = fakeCleanup(async () => [123], {
      stop: () => {
        throw Object.assign(Error("synthetic signal failure"), {
          code: "EPERM",
        });
      },
    });
    assert.equal(
      await closeWithScopedCleanup(failedClose, blocked.dependencies),
      "cleanup-blocked",
    );
    const snapshots = [[123], [], []];
    const gone = fakeCleanup(async () => snapshots.shift(), {
      stop: () => {
        throw Object.assign(Error("synthetic already gone"), { code: "ESRCH" });
      },
    });
    assert.equal(
      await closeWithScopedCleanup(failedClose, gone.dependencies),
      "stopped-after-scoped-cleanup",
    );
  },
);
test(
  "remaining or invalid process inspection stays blocked",
  options,
  async () => {
    for (const snapshot of [[123], undefined, ["123"]]) {
      const fake = fakeCleanup(async () => snapshot);
      assert.equal(
        await closeWithScopedCleanup(failedClose, fake.dependencies),
        "cleanup-blocked",
      );
    }
  },
);
test(
  "unknown cleanup retains original context/profile and prevents next launch",
  options,
  async () => {
    const original = failedClose;
    let context = original,
      profile = "synthetic-owned-profile",
      launches = 0;
    const fake = fakeCleanup(async () => {
      throw Error("synthetic inspection failure");
    });
    const receipt = [];
    await assert.rejects(async () => {
      const result = await closeWithScopedCleanup(context, fake.dependencies);
      receipt.push(result);
      assertBrowserStopped(result);
      context = null;
      profile = "synthetic-next-profile";
      launches++;
    });
    assert.equal(context, original);
    assert.equal(profile, "synthetic-owned-profile");
    assert.equal(launches, 0);
    assert.deepEqual(receipt, ["cleanup-blocked"]);
  },
);
test(
  "sequential entrypoints gate release of context on stopped receipt",
  options,
  async () => {
    for (const name of [
      "audit-workspace",
      "calendar-data",
      "readonly-concurrency",
      "slow-network",
    ]) {
      const source = await readFile(
        new URL(`./${name}.mjs`, import.meta.url),
        "utf8",
      );
      assert.match(
        source,
        /report\.cleanup\.push\(cleanup\);\s*assertBrowserStopped\(cleanup\);\s*context = null;/,
        name,
      );
    }
    const returning = await readFile(
      new URL("./returning-ux.mjs", import.meta.url),
      "utf8",
    );
    assert.match(
      returning,
      /assertBrowserStopped\(report\.bindingBrowserCleanup\);\s*context = undefined;/,
    );
  },
);
test("only explicit stopped results authorize continuation", options, () => {
  for (const status of ["stopped", "stopped-after-scoped-cleanup"])
    assertBrowserStopped(status);
  for (const status of ["cleanup-blocked", undefined, null, true, "unknown"])
    assert.throws(() => assertBrowserStopped(status));
});
