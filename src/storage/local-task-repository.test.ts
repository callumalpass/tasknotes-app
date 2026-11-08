// @vitest-environment node
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, expect, it } from "vitest";
import { LocalTaskRepository } from "./local-task-repository";

const owned: LocalTaskRepository[] = [];
const names: string[] = [];
function open(name = `local-test-${crypto.randomUUID()}`) {
  const repository = new LocalTaskRepository(name);
  owned.push(repository);
  if (!names.includes(name)) names.push(name);
  return repository;
}
afterEach(async () => {
  for (const repository of owned.splice(0)) repository.close();
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (const name of names.splice(0)) await Dexie.delete(name);
});

it("starts empty and retains tasks, settings, Scratchpad and binary files across a new repository", async () => {
  const name = `local-test-${crypto.randomUUID()}`;
  const first = open(name);
  await first.initialize();
  expect(await first.list()).toEqual([]);
  const intent = { id: crypto.randomUUID() };
  const task = await first.create(
    { title: "Before sign-in", body: "Portable **notes**", due: "2026-11-12" },
    intent,
  );
  const note = await first.getActiveScratchpad!();
  await first.saveScratchpad!({
    ...note,
    body: "Remember this",
    baseBody: note.body,
  });
  const file = await first.files!.upload(
    "Attachments/report.txt",
    new Blob(["original bytes"]),
    { mediaType: "text/plain" },
  );
  await first.updateTaskModelSettings({ defaultPriority: "high" });
  const second = open(name);
  await second.initialize();
  expect(await second.get(task.id)).toMatchObject({
    title: task.title,
    body: task.body,
    due: task.due,
    createdAt: task.createdAt,
  });
  expect((await second.getActiveScratchpad!()).body).toBe("Remember this");
  expect(await (await second.files!.download(file)).text()).toBe(
    "original bytes",
  );
  expect((await second.taskConfiguration()).defaults.priority).toBe("high");
  expect((await second.collectionInfo()).id).toBe(
    (await first.collectionInfo()).id,
  );
  // The original durable identity survives retries after reload too.
  expect((await second.create({ title: task.title }, intent)).id).toBe(task.id);
  expect(await second.list()).toHaveLength(1);
});

it("does not overwrite another tab's checkpoint during concurrent writes", async () => {
  const name = `local-test-${crypto.randomUUID()}`;
  const a = open(name),
    b = open(name);
  await a.initialize();
  const intents = [{ id: crypto.randomUUID() }, { id: crypto.randomUUID() }];
  const results = await Promise.allSettled([
    a.create({ title: "One" }, intents[0]),
    b.create({ title: "Two" }, intents[1]),
  ]);
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      expect(result.reason.message).toBe(
        "local_collection_changed_in_another_tab",
      );
      await [a, b][index]!.create(
        { title: ["One", "Two"][index]! },
        intents[index],
      );
    }
  }
  expect((await a.list()).map((task) => task.title).sort()).toEqual([
    "One",
    "Two",
  ]);
});

it("never reports a task saved when the durable checkpoint fails", async () => {
  const repository = open();
  await repository.initialize();
  const { vi } = await import("vitest");
  const database = (
    repository as unknown as {
      database: { checkpoints: { put: (...args: unknown[]) => unknown } };
    }
  ).database;
  const commit = vi
    .spyOn(database.checkpoints, "put")
    .mockRejectedValueOnce(new DOMException("Full", "QuotaExceededError"));
  await expect(repository.create({ title: "Not committed" })).rejects.toThrow(
    "Full",
  );
  commit.mockRestore();
  expect(await repository.list()).toEqual([]);
});

it("retains completed transfer receipts while offering later new local work", async () => {
  const { prepareTransfer, pendingTransferSource, suggestTransferPlan } =
    await import("../application/local-transfer");
  const repository = open();
  await repository.initialize();
  await repository.create({ title: "First import" });
  const snapshot = await repository.exportSnapshot();
  const target = {
    typeName: "task",
    configuration: await repository.taskConfiguration(),
    fingerprint: "test",
  };
  const port = {
    targets: async () => [target],
    prepareTask: async (
      task: import("../domain/task").Task,
      _target: unknown,
      id: string,
    ) => ({
      key: task.id,
      id,
      type: "task",
      path: `tasks/${id}.md`,
      frontmatter: task.frontmatter,
      body: task.body,
    }),
    write: async () => {},
  };
  const ledger = await prepareTransfer(
    snapshot,
    "destination",
    suggestTransferPlan(snapshot, target),
    port,
  );
  await repository.saveTransfer(ledger);
  expect((await repository.transfer("destination"))?.key).toBe(ledger.key);
  ledger.completed = true;
  await repository.saveTransfer(ledger);
  expect(await repository.transfer("destination")).toBeUndefined();
  const added = await repository.create({ title: "Later capture" });
  const history = await repository.transferHistory("destination");
  expect(history[0]?.records).toEqual(ledger.records);
  expect(
    pendingTransferSource(await repository.exportSnapshot(), history).tasks.map(
      (task) => task.id,
    ),
  ).toEqual([added.id]);
});
