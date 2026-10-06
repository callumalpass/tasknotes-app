import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("../vendor/", import.meta.url);
const exports = [
  "TASKNOTES_QUERY_COMPILER_VERSION",
  "TASKNOTES_QUERY_PARSER_VERSION",
  "TaskNotesQueryError",
  "compileTaskNotesQuery",
];

test("shared browser compiler preserves publisher bytes and complete runtime exports", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("tasknotes-query-6bec1906.json", root), "utf8"),
  );
  assert.equal(manifest.releaseQualified, false);
  assert.equal(
    manifest.source.head,
    "6bec1906909955b5b7f6df93b5fedd97e5de6a24",
  );
  assert.equal(
    manifest.source.sha256,
    "80dfa93195203ad41702eaddfe1e95689a40ca46d3844f5694e711c8f58e254a",
  );
  assert.equal(manifest.parser.version, "0.3.0-rc.4");
  assert.equal(
    manifest.parser.integrity,
    "sha512-3/6+27UNts+YVgISbfuSe92i+ybISRfOgnm3KD85PWNmr5V/axwVO9hkp9FngqMIsVi+AGz3ZKkZ7S8jXjo8iw==",
  );
  const expected = {
    "tasknotes-query-6bec1906.browser.mjs":
      "8802be67c88800c0795446b58c2b36cd2fc561bb79b04b0e603d0835c7a5f7cb",
    "tasknotes-query-6bec1906.browser.d.mts":
      "08ab0ef27602f503777c0194bac393a250f10ddbc879baef984a71800717b788",
    "tasknotes-query-6bec1906.browser-metafile.json":
      "6dc47dd08a2386447b918cd0c5c102f6a71d1c68173fd33b93bbdfe4137e1925",
  };
  assert.deepEqual(
    Object.fromEntries(manifest.artifacts.map((a) => [a.file, a.sha256])),
    expected,
  );
  for (const [file, hash] of Object.entries(expected)) {
    assert.equal(
      createHash("sha256")
        .update(await readFile(new URL(file, root)))
        .digest("hex"),
      hash,
    );
  }
  const compiler = await import(
    new URL("tasknotes-query-6bec1906.browser.mjs", root).href
  );
  assert.deepEqual(Object.keys(compiler).sort(), exports);
  assert.equal(compiler.TASKNOTES_QUERY_COMPILER_VERSION, 1);
  assert.equal(compiler.TASKNOTES_QUERY_PARSER_VERSION, "0.3.0-rc.4");
  assert.throws(
    () => compiler.compileTaskNotesQuery({ dialect: "obsidian-bases" }, {}),
    (error) =>
      error instanceof compiler.TaskNotesQueryError &&
      error.code === "invalid_input",
  );
});

test("compiled output contains only the compiler and canonical parser frontend", async () => {
  const graph = JSON.parse(
    await readFile(
      new URL("tasknotes-query-6bec1906.browser-metafile.json", root),
      "utf8",
    ),
  );
  const [output] = Object.values(graph.outputs);
  assert.equal(Object.keys(graph.outputs).length, 1);
  assert.deepEqual(output.imports, []);
  assert.deepEqual(output.exports.slice().sort(), exports);
  assert.equal(output.bytes, 26276);
  const contributing = Object.entries(output.inputs)
    .filter(([, input]) => input.bytesInOutput > 0)
    .map(([path]) => path)
    .sort();
  assert.deepEqual(contributing, [
    "dist/query/tasknotes.js",
    "node_modules/obsidian-bases-expression/dist/inspect.js",
    "node_modules/obsidian-bases-expression/dist/lexer.js",
    "node_modules/obsidian-bases-expression/dist/parser.js",
  ]);
});
