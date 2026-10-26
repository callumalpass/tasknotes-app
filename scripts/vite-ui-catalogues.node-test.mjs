import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeUiJsonImports,
  uiCatalogueImports,
} from "./vite-ui-catalogues.ts";

test("Vite sees all nine packed UI JSON imports as bundle-owned modules", async () => {
  const source = await readFile(
    new URL(import.meta.resolve("@mdbase-dev/ui/i18n")),
    "utf8",
  );
  const transformed = normalizeUiJsonImports(source);
  for (const locale of ["fr", "de", "es", "ja", "ko", "pt", "ru", "zh", "it"]) {
    assert.ok(
      transformed.includes(`import("./locales/${locale}/messages.json")`),
    );
  }
  // Synchronous English stays synchronous; no catalogue values are rewritten.
  assert.ok(
    transformed.includes('import english from "./locales/en/messages.json"'),
  );
  assert.equal((source.match(/type: "json"/g) ?? []).length, 10);
  assert.equal((transformed.match(/type: "json"/g) ?? []).length, 1);
});

test("normalization preserves non-JSON imports and unknown import options", () => {
  const untouched = [
    'import("./runtime.js", {with:{type:"json"}})',
    'import(path, {with:{type:"json"}})',
    'import("./messages.json", {with:{type:"json",other:"keep"}})',
    'import("./messages.json", {with:{type:"css"}})',
  ].join(";\n");
  assert.equal(normalizeUiJsonImports(untouched), untouched);
  assert.equal(
    normalizeUiJsonImports(
      "import('./messages.json', { with: { type: 'json' } })",
    ),
    "import('./messages.json')",
  );
});

test("the compatibility transform never touches application or unrelated library code", () => {
  const plugin = uiCatalogueImports();
  const code = 'const f=()=>import("./messages.json",{with:{type:"json"}})';
  const transform = plugin.transform;
  assert.equal(typeof transform, "function");
  for (const id of ["/src/i18n/app.ts", "/node_modules/other/dist/i18n.js"]) {
    assert.equal(transform.call({}, code, id), undefined);
  }
  for (const suffix of ["", "?v=2ccf8695"]) {
    assert.equal(
      transform.call(
        {},
        code,
        `/node_modules/@mdbase-dev/ui/dist/i18n.js${suffix}`,
      ).code,
      'const f=()=>import("./messages.json")',
    );
  }
});
