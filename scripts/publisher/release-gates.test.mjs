import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import {
  assertProductionEnabled,
  assertSdkFloor,
  minimumSdkCommit,
} from "./release-gates.mjs";
it("production is disabled until distinct #1223 Cloud-copy/wasm staging qualification, never inferred from smoke", () => {
  assert.doesNotThrow(() => assertProductionEnabled("staging"));
  assert.throws(
    () => assertProductionEnabled("production"),
    /production disabled/,
  );
});
it("requires actual beta.158+ pinned authenticated producer to contain the setup fix", async () => {
  const pin = { version: "0.1.0-beta.158", sourceCommit: "a".repeat(40) };
  const fetchImpl = async (url, opts) => {
    assert.ok(url.includes(minimumSdkCommit + "..." + pin.sourceCommit));
    assert.equal(opts.redirect, "error");
    return Response.json({ status: "ahead" });
  };
  await assertSdkFloor(pin, { fetchImpl });
  for (const version of ["0.1.0-beta.157", "latest", "^0.1.0-beta.158"])
    await assert.rejects(assertSdkFloor({ ...pin, version }, { fetchImpl }));
  for (const status of ["behind", "diverged"])
    await assert.rejects(
      assertSdkFloor(pin, { fetchImpl: async () => Response.json({ status }) }),
    );
  await assert.rejects(
    assertSdkFloor(pin, {
      fetchImpl: async () => new Response(null, { status: 403 }),
    }),
  );
});
it("candidate-local imports occur after ALL originals, with no dependencies in publisher checkout", async () => {
  const build = await readFile(new URL("./build.mjs", import.meta.url), "utf8");
  assert.ok(
    build.indexOf("await compareInstalled(") < build.indexOf("await import("),
  );
  assert.match(build, /pathToFileURL\(join\(root,/);
  assert.match(build, /scripts\/publisher\/candidate-build\.mjs/);
  const rehearsal = await readFile(
    new URL("./rehearsal.mjs", import.meta.url),
    "utf8",
  );
  assert.match(rehearsal, /join\(publisher,/);
  assert.doesNotMatch(rehearsal, /cp\(["']node_modules/);
});
