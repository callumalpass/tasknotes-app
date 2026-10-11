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
  it("survives close and isolates deletion commands by collection", async () => {
    const name = `task-command-journal-${crypto.randomUUID()}`;
    databases.add(name);
    const first = new IndexedDbMutationJournal(name);
    await first.put({
      kind: "delete-task",
      operationId: "delete-one",
      collectionId: "connect:one",
      taskId: "task-1",
      title: "Persist me",
      requestedAt: 2,
      commitAfter: 10,
    });
    first.close();

    const reopened = new IndexedDbMutationJournal(name);
    expect(await reopened.list("connect:one")).toMatchObject([
      { operationId: "delete-one", taskId: "task-1" },
    ]);
    expect(await reopened.list("connect:two")).toEqual([]);

    await reopened.remove("delete-one");
    expect(await reopened.list("connect:one")).toEqual([]);
    reopened.close();
  });

  it("reopens when its owner is remounted after closing it", async () => {
    const name = `task-command-journal-${crypto.randomUUID()}`;
    databases.add(name);
    const journal = new IndexedDbMutationJournal(name);
    const command = {
      kind: "delete-task" as const,
      operationId: "delete-one",
      collectionId: "connect:one",
      taskId: "task-1",
      title: "Persist me",
      requestedAt: 2,
      commitAfter: 10,
    };

    await journal.put(command);
    journal.close();

    await expect(journal.list("connect:one")).resolves.toEqual([command]);
    journal.close();
  });
});
