import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { inspectUiSource } from "./lib/i18n-source.mjs";

const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (/\.tsx?$/.test(path) && !path.includes(".test.")) files.push(path);
  }
}
await walk("src/app");
await walk("src/components");
await walk("src/i18n");
const issues = [];
for (const file of files)
  issues.push(...inspectUiSource(await readFile(file, "utf8"), file));
for (const issue of issues)
  console.error(`${issue.file}:${issue.line} ${issue.kind}: ${issue.text}`);
assert.equal(
  issues.length,
  0,
  "Unmarked interface copy or unsafe translation placement",
);
console.log(
  `Lingui source guard passed across ${files.length} UI modules (visible copy, identifiers and lazy evaluation).`,
);
