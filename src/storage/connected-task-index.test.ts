import { describe, expect, it, vi } from "vitest";
import { ConnectedTaskIndex } from "./connected-task-index";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { compareTasks, matchesArchiveFilter } from "../domain/task-query";
import type { Task, TaskListQuery } from "../domain/task";

const model = new TaskNotesTaskModel();
function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    ...model.create({ title: id }, { id, now: "2026-09-19T00:00:00Z" }),
    path: `tasks/${id}.md`,
    ...patch,
  };
}

describe("session task index", () => {
  it("matches the original filtering, substring search, ordering and limit semantics", () => {
    const index = new ConnectedTaskIndex<{ task: Task }>();
    for (let i = 0; i < 200; i++)
      index.set(String(i), {
        task: task(String(i), {
          completed: i % 3 === 0,
          archived: i % 7 === 0,
          body: `Some BODY ${i}`,
          tags: [`tag-${i % 4}`],
          projects: [`Project ${i % 5}`],
          attachments: ["[[receipt.png]]"],
          due:
            i % 2
              ? `2026-09-${String((i % 28) + 1).padStart(2, "0")}`
              : undefined,
          priority: i % 2 ? "high" : "low",
        }),
      });
    for (const status of [undefined, "all", "open", "completed"] as const)
      for (const archived of [undefined, "include", "exclude", "only"] as const)
        for (const search of [
          undefined,
          " ",
          "BoDy 17",
          "receipt project",
          "tag-3",
        ])
          for (const limit of [0, 1, 12, 200, -1, 2.5]) {
            const query: TaskListQuery = { status, archived, search, limit };
            const tokens = (search ?? "")
              .trim()
              .toLocaleLowerCase()
              .split(/\s+/)
              .filter(Boolean);
            const expected = [...index.values()]
              .map((entry) => entry.task)
              .filter((item) => {
                if (!matchesArchiveFilter(item, query)) return false;
                if (status === "completed" && !item.completed) return false;
                if (
                  status !== "completed" &&
                  status !== "all" &&
                  item.completed
                )
                  return false;
                const text = [
                  item.title,
                  item.body,
                  ...item.tags,
                  ...item.contexts,
                  ...item.projects,
                  ...item.attachments,
                ]
                  .join("\n")
                  .toLocaleLowerCase();
                return tokens.every((token) => text.includes(token));
              })
              .sort(compareTasks)
              .slice(0, limit);
            expect(
              index
                .list(query, (item, token) =>
                  index.get(item.id)!.task.body.toLowerCase().includes(token),
                )
                .map((item) => item.id),
            ).toEqual(expected.map((item) => item.id));
          }
  });

  it("reuses navigation counts until the day, hidden tasks or indexed records change", () => {
    const index = new ConnectedTaskIndex<{ task: Task }>();
    const undated = task("inbox");
    const next = task("next", { scheduled: "2026-11-11" });
    index.set(undated.id, { task: undated });
    index.set(next.id, { task: next });
    const reads = vi.spyOn(index, "values");
    expect(index.navigationCounts("2026-11-04")).toEqual({
      inbox: 1,
      upcoming: 0,
    });
    index.navigationCounts("2026-11-04").inbox = 50;
    expect(index.navigationCounts("2026-11-04", [])).toEqual({
      inbox: 1,
      upcoming: 0,
    });
    expect(reads).toHaveBeenCalledTimes(1);
    expect(index.navigationCounts("2026-11-05", ["inbox"])).toEqual({
      inbox: 0,
      upcoming: 1,
    });
    index.set(next.id, { task: { ...next, completed: true } });
    expect(index.navigationCounts("2026-11-05", ["inbox"])).toEqual({
      inbox: 0,
      upcoming: 0,
    });
    expect(index.navigationCounts("2026-11-05")).toEqual({
      inbox: 1,
      upcoming: 0,
    });
    index.delete(undated.id);
    expect(index.navigationCounts("2026-11-05")).toEqual({
      inbox: 0,
      upcoming: 0,
    });
  });

  it("indexes rolling parents without scanning ordinary tasks on each refresh", () => {
    const index = new ConnectedTaskIndex<{ task: Task }>();
    const parent = task("parent", {
      recurrence: "FREQ=DAILY",
      occurrenceMaterialization: "rolling",
    });
    index.set(parent.id, { task: parent });
    index.set("ordinary", { task: task("ordinary") });
    expect(index.rollingParents()).toEqual([parent]);
    index.set(parent.id, { task: { ...parent, recurrence: undefined } });
    expect(index.rollingParents()).toEqual([]);
    index.set(parent.id, { task: parent });
    index.delete(parent.id);
    expect(index.rollingParents()).toEqual([]);
  });

  it("tracks native records across renames, removes indexes on deletion, and isolates snapshots", () => {
    const index = new ConnectedTaskIndex<{ task: Task; recordId: string }>();
    const first = task("one");
    index.set(first.id, { task: first, recordId: "original" });
    const tracking = index.trackWrites();
    index.set(first.id, {
      task: { ...first, path: "renamed.md" },
      recordId: "replacement",
    });
    expect(index.atPath(first.path)).toBeUndefined();
    expect(index.atPath("renamed.md")?.task.id).toBe(first.id);
    expect([...tracking.records]).toEqual(["original", "replacement"]);
    tracking.stop();
    const next = task("two");
    index.set(next.id, { task: next, recordId: "next" });
    expect(tracking.records.has("next")).toBe(false);
    index.list();
    index.delete(first.id);
    expect(index.atPath("renamed.md")).toBeUndefined();
    expect(index.list()).toHaveLength(1);
    index.clear();
    expect(index.list()).toEqual([]);
    expect(index.atPath(next.path)).toBeUndefined();
  });
});

it("keeps row relations until task metadata changes", () => {
  const index = new ConnectedTaskIndex<{ task: Task }>();
  const parent = task("parent");
  const child = task("child", { projects: ["[[parent]]"] });
  index.set(parent.id, { task: parent });
  index.set(child.id, { task: child });
  const first = index.rowRelations();
  expect(first).toEqual({
    parent: { subtasks: 1, subtasksDone: 0, blockedBy: 0 },
  });
  // The same object lets observers skip work between changes.
  expect(index.rowRelations()).toBe(first);

  index.set(child.id, { task: { ...child, completed: true } });
  expect(index.rowRelations()).toEqual({
    parent: { subtasks: 1, subtasksDone: 1, blockedBy: 0 },
  });
  index.delete(child.id);
  expect(index.rowRelations()).toEqual({});
});

it("maintains Today counters incrementally, with one rebuild at day rollover", () => {
  const index = new ConnectedTaskIndex<{ task: Task }>();
  const today = "2026-09-19";
  index.todayCounts(today);
  const a = task("a", { scheduled: today });
  const b = task("b", { scheduled: "2026-09-20", due: "2026-09-18" });
  index.set(a.id, { task: a });
  index.set(b.id, { task: b });
  const enumerate = vi.spyOn(index, "values");
  expect(index.todayCounts(today, [b.id, b.id, "missing"])).toEqual({
    total: 1,
    overdue: 0,
  });
  expect(index.todayCounts(today)).toEqual({ total: 2, overdue: 1 });
  index.set(a.id, { task: { ...a, completed: true } });
  expect(index.todayCounts(today)).toEqual({ total: 1, overdue: 1 });
  index.delete(b.id);
  expect(index.todayCounts(today)).toEqual({ total: 0, overdue: 0 });
  index.set(a.id, { task: { ...a, completed: false, due: today } });
  expect(index.todayCounts(today)).toEqual({ total: 1, overdue: 0 });
  expect(enumerate).not.toHaveBeenCalled();
  expect(index.todayCounts("2026-09-20")).toEqual({ total: 1, overdue: 1 });
  expect(enumerate).toHaveBeenCalledTimes(1);
  index.clear();
  expect(index.todayCounts("2026-09-20")).toEqual({ total: 0, overdue: 0 });
});

it("refreshes cached project shortcuts when a task is replaced, deleted or cleared", () => {
  const index = new ConnectedTaskIndex<{ task: Task }>();
  const first = task("first", { projects: ["[[Alpha]]"] });
  index.set(first.id, { task: first });
  const shortcuts = index.projectShortcuts();
  shortcuts[0]!.label = "outside";
  expect(index.projectShortcuts()).toEqual([{ label: "Alpha", count: 1 }]);
  index.set(first.id, { task: { ...first, projects: ["[[Beta]]"] } });
  expect(index.projectShortcuts()).toEqual([{ label: "Beta", count: 1 }]);
  index.delete(first.id);
  expect(index.projectShortcuts()).toEqual([]);
  index.set(first.id, { task: first });
  expect(index.projectShortcuts()).toHaveLength(1);
  index.clear();
  expect(index.projectShortcuts()).toEqual([]);
});
