import { expect, it } from "vitest";
import { DemoTaskRepository } from "../demo/demo-task-repository";
import { viewExecutionBytes } from "./bounded-cache";

it("admits the same executions as full JSON measurement across chunk boundaries", async () => {
  const repository = new DemoTaskRepository(1);
  const board = (await repository.listViews())
    .flatMap((document) => document.views)
    .find((view) => view.id === "work-board")!;
  const base = await repository.executeView(board);
  for (const size of [0, 1, 128, 129, 300]) {
    const execution = {
      ...base,
      rows: Array.from({ length: size }, (_, i) => ({
        task: base.rows[0]!.task,
        values: { title: String(i) },
      })),
      totalCount: size,
    };
    const bytes = JSON.stringify(execution).length * 2;
    expect(viewExecutionBytes(execution, bytes)).toBe(bytes);
    expect(viewExecutionBytes(execution, bytes - 1)).toBeGreaterThan(bytes - 1);
  }
});
