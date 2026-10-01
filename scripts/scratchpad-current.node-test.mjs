import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Collection } from "@callumalpass/mdbase";
import { buildAppTaskNotesResources } from "./tasknotes-resources.mjs";
import { scratchpadTypeDocument } from "./scratchpad-type.mjs";

test("the mdbase authority supports an untyped, durable CAS current-note record", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tasknotes-current-note-"));
  let collection;
  try {
    const resources = buildAppTaskNotesResources();
    for (const [relative, contents] of [
      [resources.paths.config, resources.configDocument],
      [resources.paths.contract, resources.contractDocument],
      [resources.paths.type, resources.typeDocument],
      [resources.paths.taskSchema, resources.taskSchemaDocument],
      [resources.paths.bindingSchema, resources.bindingSchemaDocument],
      ["_types/tasknotes-scratch.md", scratchpadTypeDocument],
    ]) {
      const destination = path.join(root, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, contents);
    }
    const opened = await Collection.open(root);
    assert.equal(opened.error, undefined);
    collection = opened.collection;
    const operations = collection.v03Operations();
    const note = await operations.create({
      path: "TaskNotes/Scratchpad/reserved.md",
      type: "tasknotes-scratch",
      frontmatter: {
        type: "tasknotes-scratch",
        id: "reserved-identity",
        state: "converted",
        scratchpadReservationId: "reserved-identity",
        dateCreated: "2026-07-01T00:00:00.000Z",
        dateModified: "2026-07-01T00:00:00.000Z",
      },
      body: "",
    });
    assert.equal(note.valid, true, JSON.stringify(note.diagnostics));
    assert.notEqual(
      note.result.frontmatter.id,
      "reserved-identity",
      "on_create assigns the authority's UUID",
    );
    assert.equal(
      note.result.frontmatter.scratchpadReservationId,
      "reserved-identity",
      "the creation reservation must survive lifecycle evaluation",
    );
    const input = {
      path: "TaskNotes/Scratchpad/.current.md",
      frontmatter: {
        kind: "tasknotes.scratchpad-current",
        currentId: "one",
        currentPath: "scratchpads/one.md",
        pending: true,
        previousPaths: [],
        newNote: {
          path: "scratchpads/one.md",
          frontmatter: { id: "one" },
          body: "",
        },
      },
      body: "",
    };
    const created = await operations.create(input);
    assert.equal(created.valid, true, JSON.stringify(created.diagnostics));
    const collision = await operations.create(input);
    assert.equal(collision.valid, false);
    assert.ok(
      collision.diagnostics.some(
        (diagnostic) => diagnostic.code === "path_conflict",
      ),
    );
    const read = await operations.read({ path: input.path });
    assert.equal(read.valid, true, JSON.stringify(read.diagnostics));
    assert.equal(read.result.frontmatter.newNote.frontmatter.id, "one");
    const updated = await operations.update({
      path: input.path,
      if_revision: read.result.revision,
      fields: { currentId: "two", currentPath: "scratchpads/two.md" },
    });
    assert.equal(updated.valid, true, JSON.stringify(updated.diagnostics));
    const stale = await operations.update({
      path: input.path,
      if_revision: read.result.revision,
      fields: { currentId: "three" },
    });
    assert.equal(stale.valid, false);
    assert.ok(
      stale.diagnostics.some(
        (diagnostic) => diagnostic.code === "concurrent_modification",
      ),
    );
    await collection.close();
    collection = undefined;
    const reopened = await Collection.open(root);
    collection = reopened.collection;
    const persisted = await collection
      .v03Operations()
      .read({ path: input.path });
    assert.equal(persisted.result.frontmatter.currentId, "two");
  } finally {
    await collection?.close();
    await rm(root, { recursive: true, force: true });
  }
});
