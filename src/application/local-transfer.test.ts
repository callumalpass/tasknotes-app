import { taskRelationships } from "../domain/task-relationships";
// @vitest-environment node
import { expect, it, vi } from "vitest";
import { SnapshotTaskRepository } from "../storage/snapshot-task-repository";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { resolveTaskCollectionConfiguration } from "../domain/task-configuration";
import type { TaskImportPort, TaskImportTarget } from "./ports/task-import";
import {
  executeTransfer,
  prepareTransfer,
  suggestTransferPlan,
  pendingTransferSource,
  hasTransferWork,
} from "./local-transfer";

async function fixture() {
  const source = new SnapshotTaskRepository();
  const first = await source.create({
    title: "First",
    body: "Original **body**",
  });
  const second = await source.create({
    title: "Second",
    body: `[[${first.path}]]`,
    blockedBy: [{ uid: first.id, reltype: "FINISHTOSTART" }],
    attachments: ["Attachments/proof.txt"],
  });
  await source.files.upload("Attachments/proof.txt", new Blob(["proof"]), {
    mediaType: "text/plain",
  });
  const snapshot = source.snapshot();
  const configuration = resolveTaskCollectionConfiguration(
    snapshot.modelDefinition,
  );
  const model = new TaskNotesTaskModel({
    ...configuration,
    fieldMapping: {
      ...configuration.fieldMapping,
      title: "heading",
      dateCreated: "created",
      dateModified: "updated",
    },
    statuses: configuration.statuses.map((status) => ({
      ...status,
      value: `other-${status.value}`,
    })),
    priorities: configuration.priorities.map((priority) => ({
      ...priority,
      value: `other-${priority.value}`,
    })),
    defaults: {
      ...configuration.defaults,
      status: `other-${configuration.defaults.status}`,
      priority: `other-${configuration.defaults.priority}`,
    },
    userFields: [
      {
        id: "client",
        key: "client",
        displayName: "Client",
        type: "text",
        required: true,
      },
    ],
  });
  const target: TaskImportTarget = {
    typeName: "custom-work",
    configuration: model.configuration(),
    fingerprint: "schema-1",
  };
  const port: TaskImportPort = {
    targets: async () => [target],
    prepareTask: async (task, choice, id) => {
      const prepared = model.importTask(task, id);
      return {
        key: task.id,
        id,
        path: prepared.path,
        type: choice.typeName,
        frontmatter: prepared.frontmatter,
        body: prepared.body,
        targetFingerprint: choice.fingerprint,
      };
    },
    write: vi.fn(async () => {}),
  };
  const plan = suggestTransferPlan(snapshot, target);
  for (const task of snapshot.tasks) {
    plan.statuses[task.status] = `other-${task.status}`;
    plan.priorities[task.priority] = `other-${task.priority}`;
  }
  return { snapshot, model, target, port, plan, first, second };
}

it("requires explicit ambiguous mappings and missing custom fields before any destination writes", async () => {
  const f = await fixture();
  const suggestion = suggestTransferPlan(f.snapshot, f.target);
  expect(suggestion.priorities[f.first.priority]).toBeUndefined();
  await expect(
    prepareTransfer(f.snapshot, "destination", suggestion, f.port),
  ).rejects.toThrow("import_mapping_required");
  await expect(
    prepareTransfer(f.snapshot, "destination", f.plan, f.port),
  ).rejects.toThrow();
  expect(f.port.write).not.toHaveBeenCalled();
});

it("maps the selected type and preserves historical data, files and relationships without editing definitions", async () => {
  const f = await fixture();
  f.plan.customValues.client = "Example";
  const original = structuredClone(f.snapshot);
  const ledger = await prepareTransfer(
    f.snapshot,
    "destination",
    f.plan,
    f.port,
  );
  const first = ledger.prepared.find((record) => record.key === f.first.id)!;
  const second = ledger.prepared.find((record) => record.key === f.second.id)!;
  expect(first.type).toBe("custom-work");
  expect(first.frontmatter).toMatchObject({
    heading: "First",
    created: f.first.createdAt,
    updated: f.first.updatedAt,
    client: "Example",
  });
  expect(first.body).toBe("Original **body**");
  expect(second.body).toBe(`[[${first.path}]]`);
  expect(second.frontmatter.blockedBy).toEqual([
    { uid: `[[${first.path}]]`, reltype: "FINISHTOSTART" },
  ]);
  const imported = ledger.prepared
    .filter((record) => !record.key.includes(":"))
    .map((record) =>
      f.model.read({
        path: record.path,
        frontmatter: record.frontmatter,
        body: record.body,
      }),
    );
  expect(taskRelationships(imported[1]!, imported).blockedBy[0]?.task?.id).toBe(
    first.id,
  );
  expect(
    taskRelationships(imported[0]!, imported).blocking.map((task) => task.id),
  ).toContain(second.id);
  expect(second.frontmatter.attachments).toEqual([
    ledger.files["Attachments/proof.txt"]!.path,
  ]);
  const files = new SnapshotTaskRepository().files;
  await executeTransfer(ledger, f.port, files, async () => {});
  expect(await (await files.download((await files.list())[0]!)).text()).toBe(
    "proof",
  );
  expect(ledger.completed).toBe(true);
  expect(f.snapshot).toEqual(original);
});

it("resumes by checking the exact mutation after an interrupted write and never repeats confirmed records", async () => {
  const f = await fixture();
  f.plan.customValues.client = "Example";
  const ledger = await prepareTransfer(
    f.snapshot,
    "destination",
    f.plan,
    f.port,
  );
  const files = new SnapshotTaskRepository().files;
  const write = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("connection interrupted"))
    .mockResolvedValue(undefined);
  const port = { ...f.port, write };
  const save = vi.fn(async () => {});
  await expect(executeTransfer(ledger, port, files, save)).rejects.toThrow(
    "interrupted",
  );
  const resumed = structuredClone(ledger);
  await executeTransfer(resumed, port, files, save);
  expect(write).toHaveBeenCalledTimes(3);
  expect(write.mock.calls[2]![0]).toEqual(write.mock.calls[1]![0]);
  expect(write.mock.calls[2]![1]).toBe(write.mock.calls[1]![1]);
  expect(write.mock.calls[2]![2]).toBe(true);
  expect(await files.list()).toHaveLength(1);
});

it("imports newly captured work after completion and resolves links to earlier imports without duplicating them", async () => {
  const f = await fixture();
  f.plan.customValues.client = "Example";
  const firstRun = await prepareTransfer(
    f.snapshot,
    "destination",
    f.plan,
    f.port,
  );
  firstRun.completed = true;
  const newTask = {
    ...structuredClone(f.second),
    id: "later-task",
    path: "Tasks/later.md",
    title: "Later",
    body: `[[${f.first.path}]]`,
  };
  const current = { ...f.snapshot, tasks: [...f.snapshot.tasks, newTask] };
  const pending = pendingTransferSource(current, [firstRun]);
  expect(pending.tasks.map((task) => task.id)).toEqual([newTask.id]);
  expect(pending.files).toEqual([]);
  const next = await prepareTransfer(pending, "destination", f.plan, f.port, [
    firstRun,
  ]);
  expect(next.key).not.toBe(firstRun.key);
  expect(next.prepared).toHaveLength(1);
  const earlier = firstRun.prepared.find(
    (record) => record.key === f.first.id,
  )!;
  expect(next.prepared[0]!.body).toBe(`[[${earlier.path}]]`);
  expect(next.prepared[0]!.frontmatter.blockedBy).toEqual([
    { uid: `[[${earlier.path}]]`, reltype: "FINISHTOSTART" },
  ]);
});

it("rewrites short, relative, escaped and anchored Markdown links to the imported paths", async () => {
  const f = await fixture();
  f.plan.customValues.client = "Example";
  const first = f.snapshot.tasks.find((task) => task.id === f.first.id)!;
  first.path = "Local/My first task.md";
  const second = f.snapshot.tasks.find((task) => task.id === f.second.id)!;
  second.path = "Local/Nested/follow-up.md";
  second.body =
    "[[My first task#Details|Earlier task]] [earlier](./Local/My%20first%20task.md#Details) [relative](../My%20first%20task.md#Details)";
  const ledger = await prepareTransfer(
    f.snapshot,
    "destination",
    f.plan,
    f.port,
  );
  const imported = ledger.prepared.find((record) => record.key === first.id)!;
  const body = ledger.prepared.find((record) => record.key === second.id)!.body;
  expect(body).toBe(
    `[[${imported.path.replace(/\.md$/u, "")}#Details|Earlier task]] [earlier](${encodeURI(imported.path)}#Details) [relative](${encodeURI(imported.path)}#Details)`,
  );
});

it("preserves historical timestamps and leaves destination computed custom fields to the destination", async () => {
  const f = await fixture();
  f.plan.customValues.client = "Example";
  const source = f.snapshot.tasks[0]!;
  source.createdAt = "2024-01-02T03:04:05.000Z";
  source.updatedAt = "2025-06-07T08:09:10.000Z";
  const model = new TaskNotesTaskModel({
    ...f.target.configuration,
    userFields: [
      ...f.target.configuration.userFields,
      {
        id: "computed",
        key: "computed",
        displayName: "Computed",
        type: "text",
        readOnly: true,
      },
    ],
  });
  const imported = model.importTask(
    {
      ...source,
      status: `other-${source.status}`,
      priority: `other-${source.priority}`,
      customProperties: {
        client: "Example",
        computed: "stale local result",
        portableExtra: "Keep this",
      },
    },
    "destination-id",
  );
  expect(imported.createdAt).toBe(source.createdAt);
  expect(imported.updatedAt).toBe(source.updatedAt);
  expect(imported.frontmatter.computed).toBeUndefined();
  expect(imported.frontmatter.portableExtra).toBe("Keep this");
});

it("hides retained imports, reviews changed content as separate copies, and compares with the latest import", async () => {
  const f = await fixture();
  f.plan.customValues.client = "Example";
  const first = await prepareTransfer(
    f.snapshot,
    "destination",
    f.plan,
    f.port,
  );
  first.completed = true;
  first.createdAt = 1;
  expect(hasTransferWork(pendingTransferSource(f.snapshot, [first]))).toBe(
    false,
  );
  const edited = structuredClone(f.snapshot);
  edited.tasks[0]!.body = "Revised **notes**";
  edited.tasks[0]!.tags = ["changed"];
  const pending = pendingTransferSource(edited, [first]);
  expect(pending.tasks.map((task) => task.id)).toEqual([f.first.id]);
  expect(hasTransferWork(pending)).toBe(true);
  const next = await prepareTransfer(pending, "destination", f.plan, f.port, [
    first,
  ]);
  expect(next.prepared).toHaveLength(1);
  expect(next.prepared[0]!.id).not.toBe(first.prepared[0]!.id);
  expect(next.prepared[0]!.body).toBe("Revised **notes**");
  expect(first.prepared[0]!.body).toBe("Original **body**");
  next.completed = true;
  next.createdAt = 2;
  // History order and old matching versions cannot hide a change after the latest import.
  expect(hasTransferWork(pendingTransferSource(edited, [next, first]))).toBe(
    false,
  );
  expect(
    pendingTransferSource(f.snapshot, [next, first]).tasks.map(
      (task) => task.id,
    ),
  ).toEqual([f.first.id]);
  // An incomplete import and another local collection's history cannot suppress work.
  expect(
    hasTransferWork(
      pendingTransferSource(f.snapshot, [{ ...first, completed: false }]),
    ),
  ).toBe(true);
  expect(
    hasTransferWork(
      pendingTransferSource(f.snapshot, [
        { ...first, source: { ...first.source, id: "different-source" } },
      ]),
    ),
  ).toBe(true);
});

it("reviews edited notes, images and files without treating Scratchpad history movement as new content", async () => {
  const f = await fixture();
  f.plan.customValues.client = "Example";
  f.snapshot.tasks = [];
  f.snapshot.scratchpads = [
    {
      id: "note",
      path: "Scratchpad/note.md",
      revision: "scratch-1",
      state: "active",
      dateCreated: "2026-11-08T01:00:00Z",
      dateModified: "2026-11-08T01:00:00Z",
      body: "Original note",
    },
  ];
  f.snapshot.scratchImages = [
    {
      kind: "image",
      id: "image",
      path: "Scratchpad/image.md",
      revision: "image-1",
      dateCreated: "2026-11-08T01:00:00Z",
      dateModified: "2026-11-08T01:00:00Z",
      file: "Attachments/proof.txt",
      digest: `sha256:${"a".repeat(64)}`,
      size: 5,
      mediaType: "image/png",
    },
  ];
  const first = await prepareTransfer(
    f.snapshot,
    "destination",
    f.plan,
    f.port,
  );
  first.completed = true;
  const current = structuredClone(f.snapshot);
  Object.assign(current.scratchpads[0]!, {
    state: "converted",
    revision: "scratch-2",
    dateModified: "2026-11-08T02:00:00Z",
    dateConverted: "2026-11-08T02:00:00Z",
  });
  expect(hasTransferWork(pendingTransferSource(current, [first]))).toBe(false);
  current.scratchpads[0]!.body = "Updated note";
  current.scratchImages[0]!.caption = "New caption";
  current.files[0]!.file.contentDigest = `sha256:${"b".repeat(64)}`;
  const pending = pendingTransferSource(current, [first]);
  expect(pending.scratchpads).toHaveLength(1);
  expect(pending.scratchImages).toHaveLength(1);
  expect(pending.files).toHaveLength(1);
  expect(hasTransferWork(pending)).toBe(true);
});

it("ignores empty Scratchpad placeholders and task save bookkeeping", async () => {
  const f = await fixture();
  f.plan.customValues.client = "Example";
  const first = await prepareTransfer(
    f.snapshot,
    "destination",
    f.plan,
    f.port,
  );
  first.completed = true;
  const source = structuredClone(f.snapshot);
  source.tasks[0]!.revision++;
  source.tasks[0]!.updatedAt = "2026-11-09T01:00:00Z";
  source.tasks[0]!.frontmatter = {
    ...source.tasks[0]!.frontmatter,
    revision: 2,
  };
  // Custom object insertion order does not change its meaning.
  source.tasks[0]!.customProperties = Object.fromEntries(
    Object.entries(source.tasks[0]!.customProperties).reverse(),
  );
  expect(hasTransferWork(pendingTransferSource(source, [first]))).toBe(false);
  const empty = new SnapshotTaskRepository();
  await empty.initialize();
  expect(hasTransferWork(empty.snapshot())).toBe(false);
});
