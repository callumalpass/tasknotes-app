import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { measureStartupGraph } from "./measure-startup-graph.mjs";

async function fixture(run, patch = {}) {
  const root = await mkdtemp(
    fileURLToPath(new URL(".startup-graph-test-", import.meta.url)),
  );
  try {
    await mkdir(root + "/.vite");
    const manifest = {
      "index.html": {
        isEntry: true,
        file: "app.js",
        imports: ["shared"],
        dynamicImports: ["optional"],
      },
      shared: { file: "shared.js", imports: ["index.html"] },
      optional: {
        file: "optional.js",
        isDynamicEntry: true,
        imports: ["shared"],
      },
      worker: { file: "worker.js", isEntry: true },
      ...patch,
    };
    await writeFile(root + "/.vite/manifest.json", JSON.stringify(manifest));
    await writeFile(
      root + "/index.html",
      '<script src="/app.js"></script><link rel="modulepreload" href="/shared.js">',
    );
    for (const name of ["app", "shared", "optional", "worker"])
      await writeFile(root + "/" + name + ".js", name);
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("startup bytes deduplicate cycles and exclude dynamic imports and separate Workers", async () => {
  await fixture(async (root) => {
    const result = await measureStartupGraph(root);
    assert.equal(result.eagerJsFiles, 2);
    assert.equal(result.eagerJsBytes, 9);
    assert.equal(result.htmlListedJsFiles, 2);
    assert.equal(result.htmlListedJsBytes, 9);
    assert.deepEqual(
      result.artifacts.map((item) => item.file),
      ["app.js", "shared.js"],
    );
  });
});
test("unknown static manifest dependencies fail instead of undercounting", async () => {
  await fixture(
    (root) => assert.rejects(measureStartupGraph(root), /Missing static/),
    { shared: { file: "shared.js", imports: ["missing"] } },
  );
});
test("assets outside the emitted root cannot enter the measurement", async () => {
  await fixture(
    (root) => assert.rejects(measureStartupGraph(root), /leaves build root/),
    { shared: { file: "../outside.js" } },
  );
});
test("optional calendar/editor/catalog assertions fail on eager or absent chunks", async () => {
  await fixture((root) =>
    assert.rejects(
      measureStartupGraph(root, { requireOptionalSplit: true }),
      /re-entered the eager/,
    ),
  );
});
