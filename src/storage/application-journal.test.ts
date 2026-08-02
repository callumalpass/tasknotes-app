import "fake-indexeddb/auto";

import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";

import { IndexedDbMutationJournal } from "./application-journal";

const databases = new Set<string>();

afterEach(async () => {
  await Promise.all([...databases].map((name) => Dexie.delete(name)));
  databases.clear();
});

describe("IndexedDbMutationJournal", () => {
  it("survives close and isolates commands by collection", async () => {
    const name = `task-command-journal-${crypto.randomUUID()}`;
    databases.add(name);
    const first = new IndexedDbMutationJournal(name);
    await first.put({
      kind: "delete-task",
      operationId: "delete-one",
      collectionId: "local:one",
      taskId: "task-1",
      title: "Persist me",
      requestedAt: 2,
      commitAfter: 10,
    });
    await first.put({
      kind: "update-tasks",
      operationId: "update-two",
      collectionId: "connect:two",
      requestedAt: 1,
      updates: [{ id: "task-2", input: { status: "done" } }],
    });
    first.close();

    const reopened = new IndexedDbMutationJournal(name);
    expect(await reopened.list("local:one")).toMatchObject([
      { operationId: "delete-one", taskId: "task-1" },
    ]);
    expect(await reopened.list("connect:two")).toMatchObject([
      { operationId: "update-two" },
    ]);

    await reopened.remove("delete-one");
    expect(await reopened.list("local:one")).toEqual([]);
    reopened.close();
  });

  it("reopens when its owner is remounted after closing it", async () => {
    const name = `task-command-journal-${crypto.randomUUID()}`;
    databases.add(name);
    const journal = new IndexedDbMutationJournal(name);
    const command = {
      kind: "delete-task" as const,
      operationId: "delete-one",
      collectionId: "local:one",
      taskId: "task-1",
      title: "Persist me",
      requestedAt: 2,
      commitAfter: 10,
    };

    await journal.put(command);
    journal.close();

    await expect(journal.list("local:one")).resolves.toEqual([command]);
    journal.close();
  });
});
