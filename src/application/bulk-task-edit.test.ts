import { describe, expect, it, vi } from "vitest";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import {
  applyBulkEdits,
  planTaskChange,
  taskNeedsChange,
  undoBulkEdits,
  type BulkEditPort,
  type BulkTaskChange,
} from "./bulk-task-edit";
import type { UpdateTaskInput } from "../domain/task";
const model = new TaskNotesTaskModel();
const fixture = () => {
  const tasks = ["a", "b", "c"].map((id) =>
    model.create(
      {
        title: id,
        scheduled: "2026-11-01T10:30",
        priority: "high",
        tags: ["home"],
        projects: ["[[Old]]", "[[Other]]"],
      },
      { id },
    ),
  );
  const current = new Map(tasks.map((task) => [task.id, task]));
  const updateTask = vi.fn(async (id: string, input: UpdateTaskInput) => {
    if (id === "b") throw new Error("conflict: changed elsewhere");
    const saved = {
      ...model.update(current.get(id)!, input),
      revision: current.get(id)!.revision + 1,
    };
    current.set(id, saved);
    return saved;
  });
  const port: BulkEditPort = {
    getSummary: async (id) => current.get(id) ?? null,
    updateTask,
    setTaskArchived: vi.fn(async (id, archived) =>
      updateTask(id, { archived }),
    ),
  };
  return { tasks, current, port, updateTask };
};
describe("bulk edits", () => {
  it.each<BulkTaskChange>([
    { kind: "complete" },
    { kind: "schedule", date: "2026-11-08" },
    { kind: "schedule", date: null },
    { kind: "status", value: "in-progress" },
    { kind: "priority", value: "low" },
    { kind: "tag", value: "errand", remove: false },
    { kind: "tag", value: "home", remove: true },
    { kind: "project", value: "[[New]]" },
    { kind: "archive" },
  ])("restores prior values and reports failed rows for %o", async (change) => {
    const { tasks, port, current } = fixture();
    const result = await applyBulkEdits(
      tasks,
      (task) => planTaskChange(task, change),
      port,
      "changed",
      change.kind === "archive",
    );
    expect(result.receipts.map((receipt) => receipt.saved.id)).toEqual([
      "a",
      "c",
    ]);
    expect(result.failures.map((failure) => failure.task.id)).toEqual(["b"]);
    expect(String(result.failures[0].reason)).toContain("conflict");
    const undone = await undoBulkEdits(result.receipts, port, "changed");
    expect(undone.failures).toEqual([]);
    for (const id of ["a", "c"]) {
      const before = tasks.find((task) => task.id === id)!;
      const saved = current.get(id)!;
      expect([
        saved.completed,
        saved.status,
        saved.scheduled,
        saved.priority,
        saved.projects,
        saved.archived,
      ]).toEqual([
        before.completed,
        before.status,
        before.scheduled,
        before.priority,
        before.projects,
        before.archived,
      ]);
      if (change.kind === "tag") expect(saved.tags).toEqual(before.tags);
    }
  });
  it("adds or removes one tag and leaves the others in place", () => {
    const { tasks } = fixture();
    expect(
      planTaskChange(tasks[0], { kind: "tag", value: "errand", remove: false }),
    ).toEqual({
      input: { tags: ["home", "errand"] },
      undo: { tags: ["home"] },
    });
    expect(
      planTaskChange(tasks[0], { kind: "tag", value: "home", remove: true }),
    ).toEqual({ input: { tags: [] }, undo: { tags: ["home"] } });
  });
  it("skips tasks already in the requested state", () => {
    const { tasks } = fixture();
    const [task] = tasks;
    expect(taskNeedsChange(task, { kind: "status", value: task.status })).toBe(
      false,
    );
    expect(taskNeedsChange(task, { kind: "status", value: "done" })).toBe(true);
    expect(
      taskNeedsChange(task, { kind: "tag", value: "home", remove: false }),
    ).toBe(false);
    expect(
      taskNeedsChange(task, { kind: "tag", value: "home", remove: true }),
    ).toBe(true);
    expect(taskNeedsChange(task, { kind: "priority", value: "high" })).toBe(
      true,
    );
  });
  it.each([
    ["2026-11-01", "2026-11-08"],
    ["2026-03-07", "2026-03-08"], // Los Angeles enters DST.
    ["2026-10-03", "2026-10-04"], // Melbourne enters DST.
  ])(
    "keeps local scheduled time from %s to %s and leaves Due alone",
    (from, to) => {
      const task = model.create(
        {
          title: "Timed task",
          scheduled: `${from}T10:30`,
          due: "2026-11-30T17:00",
        },
        { id: "timed-task" },
      );
      // Inputs are local wall times; the model stores canonical UTC instants.
      // Construct the expected instant independently for the chosen local day.
      const [year, month, day] = to.split("-").map(Number);
      const scheduled = new Date(year, month - 1, day, 10, 30)
        .toISOString()
        .replace(".000Z", "Z");
      const change = planTaskChange(task, { kind: "schedule", date: to });
      expect(change).toEqual({
        input: { scheduled },
        undo: { scheduled: task.scheduled },
      });
      expect(model.update(task, change.input).due).toBe(task.due);
    },
  );
  it("does not write stale selections or overwrite edits made after a bulk write", async () => {
    const { tasks, current, port, updateTask } = fixture();
    current.set("a", { ...tasks[0], revision: 99 });
    const result = await applyBulkEdits(
      tasks,
      (task) => planTaskChange(task, { kind: "priority", value: "low" }),
      port,
      "changed",
    );
    expect(result.failures.map((failure) => failure.task.id)).toEqual([
      "a",
      "b",
    ]);
    expect(updateTask).not.toHaveBeenCalledWith("a", expect.anything());
    current.set("c", { ...current.get("c")!, revision: 99, priority: "high" });
    updateTask.mockClear();
    const undone = await undoBulkEdits(result.receipts, port, "changed");
    expect(undone.remaining).toHaveLength(1);
    expect(undone.failures[0].task.id).toBe("c");
    expect(updateTask).not.toHaveBeenCalled();
  });
  it("keeps uncertain outcomes as failures and never retries them", async () => {
    const { tasks, port, updateTask } = fixture();
    updateTask.mockRejectedValue(new Error("outcome-unknown"));
    const result = await applyBulkEdits(
      tasks,
      (task) => planTaskChange(task, { kind: "complete" }),
      port,
      "changed",
    );
    expect(result.receipts).toEqual([]);
    expect(result.failures).toHaveLength(3);
    expect(updateTask).toHaveBeenCalledTimes(3);
  });
});
