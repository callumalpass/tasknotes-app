import "fake-indexeddb/auto";
import Dexie from "dexie";

import { TaskIndex } from "./index";

describe("TaskIndex", () => {
  it("removes unused secondary indexes without discarding cached tasks", async () => {
    const name = `tasknotes-index-test-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      tasks:
        "&id,&path,completed,status,scheduled,due,priority,updatedAt,sourceMtime",
    });
    await legacy.table("tasks").put({
      id: "task-1",
      path: "tasks/task-1.md",
      title: "Preserved task",
    });
    legacy.close();

    const upgraded = new TaskIndex(name);
    try {
      await upgraded.open();
      expect(upgraded.tasks.schema.indexes).toHaveLength(0);
      expect(await upgraded.tasks.get("task-1")).toMatchObject({
        id: "task-1",
        title: "Preserved task",
      });
      expect(upgraded.metadata.schema.primKey.name).toBe("key");
    } finally {
      upgraded.close();
      await upgraded.delete();
    }
  });
});
