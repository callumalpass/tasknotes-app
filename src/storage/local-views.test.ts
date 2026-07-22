import { describe, expect, it } from "vitest";

import { MemoryVault } from "../test/memory-vault";
import { MarkdownCollection } from "./collection";
import { LocalViewExecutor } from "./local-views";

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
    ]);
    for (const item of tasks) await collection.write(item);
    await vault.writeText(
      "views/tasks.base",
      `
filters:
  and:
    - file.hasTag("task")
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

    const views = await executor.list();
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
