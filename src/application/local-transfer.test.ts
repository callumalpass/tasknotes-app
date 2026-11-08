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
