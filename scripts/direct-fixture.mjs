import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export async function seedDirectFixture(directory) {
  const root = resolve(directory);
  await mkdir(root, { mode: 0o700 });
  const manifest = JSON.parse(
    await readFile(
      new URL("../src/generated/mdbase-app.json", import.meta.url),
    ),
  );
  for (const pack of manifest.provisions.type_packs) {
    for (const { source, target } of pack.manifest.resources) {
      const entry = pack.resources.find((item) => item.source === source);
      const destination = resolve(root, target);
      assert(entry && destination.startsWith(root + sep));
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, entry.document, { flag: "wx" });
    }
  }
  await writeFile(
    join(root, "mdbase.yaml"),
    `spec_version: "0.3.0"
name: Direct fixture
settings:
  types_folder: _types
  contracts_folder: _contracts
  explicit_type_keys: [type, types]
  record_extensions: [md, base]
  id_field: id
x-obsidian:
  bases:
    include: ["TaskNotes/Views/**/*.base"]
`,
  );
  await mkdir(join(root, "tasks"));
  await writeFile(
    join(root, "tasks/proof.md"),
    `---
type: task
tags: [task]
id: direct-fixture
title: Loopback original
status: open
priority: normal
dateCreated: "2000-01-01T00:00:00Z"
due: 2000-01-01
mobileRevision: 1
---
Synthetic fixture body.
`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  assert(
    process.argv.length === 3,
    "Expected a new, nonexistent fixture folder",
  );
  await seedDirectFixture(process.argv[2]);
}
