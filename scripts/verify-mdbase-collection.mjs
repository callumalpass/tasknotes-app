import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Collection } from "@callumalpass/mdbase";
import { buildAppTaskNotesResources } from "./tasknotes-resources.mjs";

const root = await mkdtemp(path.join(tmpdir(), "tasknotes-app-mdbase-"));
try {
  const resources = buildAppTaskNotesResources();
  await write(root, resources.paths.config, resources.configDocument);
  await write(root, resources.paths.type, resources.typeDocument);

  const opened = await Collection.open(root);
  assert.equal(opened.error, undefined, opened.error?.message);
  const collection = opened.collection;
  assert.ok(collection);
  const operations = collection.v03Operations();

  const created = await operations.create({
    type: "task",
    frontmatter: {
      type: "task",
      title: "Conformance task",
      status: "open",
      priority: "normal",
      mobileRevision: 1,
    },
    body: "Portable Markdown body.",
  });
  assert.equal(created.valid, true, JSON.stringify(created.diagnostics));
  assert.equal(typeof created.result?.path, "string");
  const taskPath = created.result.path;

  const read = await operations.read({ path: taskPath });
  assert.equal(read.valid, true, JSON.stringify(read.diagnostics));
  assert.equal(read.result?.frontmatter?.title, "Conformance task");
  assert.equal(read.result?.body?.trimEnd(), "Portable Markdown body.");
  assert.match(
    String(read.result?.frontmatter?.dateCreated),
    /Z|[+-]\d\d:\d\d$/,
  );

  const invalidCompletion = await operations.update({
    path: taskPath,
    fields: { status: "done" },
  });
  assert.equal(
    invalidCompletion.valid,
    false,
    "mdbase must enforce TaskNotes completed_date requiredness",
  );

  const completed = await operations.update({
    path: taskPath,
    fields: {
      status: "done",
      completedDate: "2026-07-21",
      mobileRevision: 2,
    },
  });
  assert.equal(completed.valid, true, JSON.stringify(completed.diagnostics));

  const validation = await operations.validate({ path: taskPath });
  assert.equal(validation.valid, true, JSON.stringify(validation.diagnostics));
  await collection.close();
  process.stdout.write("mdbase v0.3 collection oracle: passed\n");
} finally {
  await rm(root, { recursive: true, force: true });
}

async function write(rootPath, relativePath, contents) {
  const destination = path.join(rootPath, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents, "utf8");
}
