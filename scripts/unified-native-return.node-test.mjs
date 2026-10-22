import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("Native callback delegates completion and popup lifetime to the original SDK owner", async () => {
  const entry = await readFile(
    new URL("../src/main.tsx", import.meta.url),
    "utf8",
  );
  const callback = entry.slice(
    entry.indexOf("if (grantReturn)"),
    entry.indexOf("else startApp()"),
  );
  assert.match(callback, /deliverAppGrantReturn/);
  assert.doesNotMatch(
    callback,
    /window\.close\s*\(/,
    "callback delivery is not Native finish + original custody ACK",
  );
  assert.doesNotMatch(
    callback,
    /startApp\s*\(/,
    "the callback must not start another installation owner",
  );
});
