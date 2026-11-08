import { expect, it } from "vitest";
import {
  parseFrontmatter,
  serializeMarkdownDocument,
} from "@tasknotes/model/frontmatter";
import { nextTaskFixture } from "../test/next-task-fixture";
import { SnapshotTaskRepository } from "./snapshot-task-repository";

it("imports into an explicitly selected implementing type, confirms the original mutation and preserves definitions", async () => {
  const f = await nextTaskFixture();
  try {
    const definition = await f.client.resources.get("_types/task.md");
    const parsed = parseFrontmatter(definition.text!);
    f.replica.seedResource(
      "_types/work-task.md",
      serializeMarkdownDocument(
        { ...parsed.frontmatter, name: "work-task" },
        parsed.body,
      ),
    );
    f.catalog.types.push({
      ...structuredClone(f.catalog.types[0]!),
      name: "work-task",
      path: "_types/work-task.md",
    });
    const source = new SnapshotTaskRepository();
    const original = await source.create({
      title: "Original title",
      body: "Original body",
    });
    const targets = await f.repository.imports.targets();
    const target = targets.find(
      (candidate) => candidate.typeName === "work-task",
    )!;
    expect(target).toBeDefined();
    const id = crypto.randomUUID(),
      mutation = crypto.randomUUID();
    const prepared = await f.repository.imports.prepareTask(
      original,
      target,
      id,
    );
    await f.repository.imports.write(prepared, mutation, false);
    const read = await f.client.get(id, { body: true, effective: true });
    expect(read.types).toContain("work-task");
    expect((await f.repository.get(id))!).toMatchObject({
      title: original.title,
      body: original.body,
      createdAt: original.createdAt,
      updatedAt: original.updatedAt,
    });
    expect((await f.client.receipt(mutation)).state).toBe("confirmed");
    await f.repository.imports.write(prepared, mutation, true);
    expect(
      f.replica.allRecords.filter((record) => record.id === id),
    ).toHaveLength(1);
    expect((await f.client.resources.get("_types/task.md")).text).toBe(
      definition.text,
    );
  } finally {
    f.close();
  }
});

it("detects a destination source edit even when the resolved task settings are unchanged", async () => {
  const f = await nextTaskFixture();
  try {
    const source = new SnapshotTaskRepository();
    const task = await source.create({
      title: "Reviewed before the schema changed",
    });
    const target = (await f.repository.imports.targets())[0]!;
    const definition = await f.client.resources.get("_types/task.md");
    f.replica.seedResource(
      "_types/task.md",
      `${definition.text}\nDefinition changed after review.\n`,
    );
    await expect(
      f.repository.imports.prepareTask(task, target, crypto.randomUUID()),
    ).rejects.toThrow("import_destination_definition_changed");
    expect(f.replica.allRecords).toHaveLength(0);
  } finally {
    f.close();
  }
});
