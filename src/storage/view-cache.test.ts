import { describe, expect, it } from "vitest";

import { TaskViewCache } from "./view-cache";

describe("TaskViewCache", () => {
  it("opens descriptors cached before ordered properties were introduced", async () => {
    const cache = new TaskViewCache(`legacy-${crypto.randomUUID()}`);
    const legacyView = {
      key: "views/tasks.md#all",
      documentId: "tasks",
      documentName: "Tasks",
      id: "all",
      name: "All tasks",
      source: {
        path: "views/tasks.md",
        format: "mdbase.view",
        revision: "old",
        writable: true,
      },
    };
    await cache.table("entries").put({ key: "views", value: [legacyView] });
    await cache.table("entries").put({
      key: `execution:${legacyView.key}`,
      value: {
        view: legacyView,
        rows: [],
        totalCount: 0,
        hasMore: false,
        groups: [],
      },
    });

    expect((await cache.readViewDocuments())[0].views[0].properties).toEqual(
      [],
    );
    expect((await cache.readExecution(legacyView))?.view.properties).toEqual(
      [],
    );
    await cache.delete();
  });

  it("does not restore an execution from a different view revision", async () => {
    const cache = new TaskViewCache(`revision-${crypto.randomUUID()}`);
    const view = {
      key: "views/tasks.md#all",
      documentId: "tasks",
      documentName: "Tasks",
      id: "all",
      name: "All tasks",
      properties: [],
      source: {
        path: "views/tasks.md",
        format: "mdbase.view",
        revision: "r1",
        writable: true,
      },
    };
    await cache.writeExecution({
      view,
      rows: [],
      totalCount: 0,
      hasMore: false,
      groups: [],
    });

    expect(await cache.readExecution(view)).not.toBeNull();
    expect(
      await cache.readExecution({
        ...view,
        source: { ...view.source, revision: "r2" },
      }),
    ).toBeNull();
    await cache.delete();
  });
});
