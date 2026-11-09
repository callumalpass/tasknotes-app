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

it("round-trips a populated task's notes and metadata through transfer and destination readback", async () => {
  const { prepareTransfer, executeTransfer, suggestTransferPlan } =
    await import("../application/local-transfer");
  const f = await nextTaskFixture();
  try {
    const source = new SnapshotTaskRepository();
    const created = await source.create({
      title: "Populated local import",
      body: "# Notes\n\nKeep **all** supporting details.\n\n- First point\n- Second point\n",
      priority: "high",
      scheduled: "2026-11-12T10:00",
      due: "2026-11-13T17:00",
      tags: ["research", "planning"],
      contexts: ["home"],
      projects: ["[[Projects/Import check]]"],
      assignees: ["[[People/Ada]]"],
      attachments: ["Attachments/spec.pdf"],
      recurrence: "FREQ=WEEKLY;BYDAY=TH",
      recurrenceAnchor: "scheduled",
      reminders: [
        {
          id: "before-due",
          type: "relative",
          relatedTo: "due",
          offset: "-PT30M",
        },
      ],
      timeEstimate: 45,
      sortOrder: "a1",
    });
    const original = await source.replaceTimeEntries(created.id, [
      {
        startTime: "2026-11-08T09:00:00Z",
        endTime: "2026-11-08T09:15:00Z",
        description: "Research notes",
      },
    ]);
    const target = (await f.repository.imports.targets())[0]!;
    const snapshot = source.snapshot();
    const ledger = await prepareTransfer(
      snapshot,
      "destination",
      suggestTransferPlan(snapshot, target),
      f.repository.imports,
    );
    await executeTransfer(
      ledger,
      f.repository.imports,
      undefined,
      async () => {},
    );
    const importedId = ledger.records[original.id]!.id;
    const imported = (await f.repository.get(importedId))!;
    for (const key of [
      "title",
      "body",
      "status",
      "priority",
      "scheduled",
      "due",
      "tags",
      "contexts",
      "projects",
      "assignees",
      "attachments",
      "recurrence",
      "recurrenceAnchor",
      "reminders",
      "timeEstimate",
      "timeEntries",
      "sortOrder",
      "createdAt",
      "updatedAt",
    ] as const) {
      expect(imported[key], key).toEqual(original[key]);
    }
    const stored = await f.client.get(importedId, {
      body: true,
      document: true,
      effective: true,
    });
    expect(stored.body).toBe(original.body);
    expect(stored.document).toContain("# Notes");
    expect(ledger.completed).toBe(true);
  } finally {
    f.close();
  }
});
