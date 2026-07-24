import { describe, expect, it } from "vitest";

import { MemoryVault } from "../test/memory-vault";
import { MarkdownCollection } from "./collection";
import { LocalViewExecutor } from "./local-views";
import { taskNotesDefaultBaseDocument } from "../domain/default-view-source";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import { serializeMarkdownDocument } from "@tasknotes/model/frontmatter";

import type { Task } from "../domain/task";

describe("local Obsidian Bases views", () => {
  it("discovers stable views and executes filters, formulas, grouping, and calendar metadata", async () => {
    const vault = new MemoryVault();
    const collection = new MarkdownCollection(vault);
    await collection.initialize();
    const tasks = await Promise.all([
      task(collection, "one", "Write tests", "open", "2026-07-22", 2),
      task(collection, "two", "Ship views", "done", "2026-07-23", 1),
      task(collection, "three", "Document views", "open", undefined, 3),
      task(collection, "four", "Archived work", "open", "2026-07-24", 4),
    ]);
    tasks[0].tags = ["task", "archived"];
    tasks[3].frontmatter.tags = ["task", "archived"];
    for (const item of tasks) await collection.write(item);
    await vault.writeText(
      "views/tasks.base",
      `
filters:
  and:
    - file.hasTag("task")
    - file.hasTag("archived") != true
formulas:
  rank: priority * 10
properties:
  note.status:
    displayName: State
  formula.rank:
    displayName: Rank
views:
  - type: tasknotesKanban
    name: Work board
    filters:
      and:
        - status != "done"
    groupBy:
      property: status
      direction: ASC
    order: [formula.rank]
    sort:
      - property: priority
        direction: DESC
      - property: formula.rank
        direction: DESC
  - type: tasknotesCalendar
    name: Dates
    order: [due, file.name]
    sort:
      - property: due
        direction: ASC
    options:
      showDue: true
      showScheduled: false
`,
    );
    const executor = new LocalViewExecutor(collection, () => tasks);

    const documents = await executor.list();
    const views = documents.flatMap((document) => document.views);
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({
      name: "tasks",
      source: { path: "views/tasks.base" },
    });
    expect(views.map((view) => [view.id, view.presentation?.type])).toEqual([
      ["work-board", "tasknotes.kanban"],
      ["dates", "tasknotes.calendar"],
    ]);
    expect(views[0].source.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(views[0].properties).toEqual([
      { key: "formula.rank", label: "Rank" },
    ]);

    const board = await executor.execute(views[0]);
    expect(board.rows.map((row) => row.task.id)).toEqual(["three", "one"]);
    expect(board.rows.map((row) => row.values["formula.rank"])).toEqual([
      30, 20,
    ]);
    expect(board.rows[0].values).not.toHaveProperty("priority");
    expect(board.rows[0].values.status).toBe("open");
    expect(board.groups).toEqual([
      { values: { status: "open" }, count: 2, summaries: {} },
    ]);

    const calendar = await executor.execute(views[1]);
    expect(calendar.rows.map((row) => row.values.due)).toEqual([
      "2026-07-22",
      "2026-07-23",
      null,
    ]);
  });

  it("executes the project relationship view over collection records without per-project reads", async () => {
    const vault = new MemoryVault();
    const collection = new MarkdownCollection(vault);
    await collection.initialize();
    const linked = await task(
      collection,
      "linked",
      "Ship mobile",
      "open",
      undefined,
      1,
    );
    linked.projects = ["[[Projects/Roadmap]]"];
    linked.frontmatter.projects = linked.projects;
    await collection.write(linked);
    await vault.writeText(
      "Projects/Roadmap.md",
      serializeMarkdownDocument(
        { title: "Mobile roadmap", owner: "Callum" },
        "Project notes",
      ),
    );
    await vault.writeText(
      "views/tasknotes-app.base",
      taskNotesDefaultBaseDocument(defaultTaskCollectionConfiguration()),
    );
    const executor = new LocalViewExecutor(collection, () => [linked]);
    const projectView = (await executor.list())
      .flatMap((document) => document.views)
      .find(({ name }) => name === "Projects");

    expect(projectView).toBeDefined();
    const execution = await executor.execute(projectView!);
    expect(execution.rows).toEqual([]);
    expect(execution.records).toEqual([
      expect.objectContaining({
        record: expect.objectContaining({
          path: "Projects/Roadmap.md",
          label: "Mobile roadmap",
        }),
      }),
    ]);
    expect(execution.totalCount).toBe(1);
  });
});

function task(
  collection: MarkdownCollection,
  id: string,
  title: string,
  status: string,
  due: string | undefined,
  priority: number,
): Promise<Task> {
  return collection
    .createTask(
      { title, ...(due ? { due } : {}) },
      id,
      "2026-07-20T00:00:00.000Z",
    )
    .then((item) => {
      item.status = status;
      item.completed = status === "done";
      item.frontmatter.status = status;
      item.frontmatter.priority = priority;
      item.frontmatter.tags = ["task"];
      item.priority = String(priority);
      item.tags = ["task"];
      return item;
    });
}
