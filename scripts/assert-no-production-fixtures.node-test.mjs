import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { assertNoProductionFixtures } from "./assert-no-production-fixtures.mjs";

async function bundle(source, run) {
  const cache = resolve("node_modules/.cache");
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(join(cache, "fixture-pruning-"));
  try {
    await writeFile(
      join(directory, "index.html"),
      '<script src="/app.js"></script>',
    );
    await writeFile(join(directory, "app.js"), source);
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("ordinary production bundle passes", async () => {
  await bundle("renderOriginalNativeGate();", assertNoProductionFixtures);
});
for (const source of [
  'const title = "Review demo task";',
  'const fixture = "__TASKNOTES_NEXT_SMOKE__";',
  'url.searchParams.get("demo");',
]) {
  test(`rejects emitted test-only code: ${source}`, async () => {
    await bundle(source, async (directory) => {
      await assert.rejects(
        assertNoProductionFixtures(directory),
        /Test-only fixture emitted/,
      );
    });
  });
}

test("empty app output cannot masquerade as fixture pruning", async () => {
  await bundle("", async (directory) => {
    await rm(join(directory, "app.js"));
    await assert.rejects(
      assertNoProductionFixtures(directory),
      /No emitted application scripts/,
    );
  });
});
