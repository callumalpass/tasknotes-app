import { expect, it } from "vitest";
import type { TaskViewExecution } from "../domain/view";
import { viewExecutionBytes } from "./bounded-cache";

it("admits the same executions as full JSON measurement across chunk boundaries", () => {
  for (const size of [0, 1, 128, 129, 300]) {
    const execution = {
      rows: Array.from({ length: size }, (_, i) => ({
        values: { title: String(i) },
      })),
      groups: [],
      totalCount: size,
      hasMore: false,
    } as TaskViewExecution;
    const bytes = JSON.stringify(execution).length * 2;
    expect(viewExecutionBytes(execution, bytes)).toBe(bytes);
    expect(viewExecutionBytes(execution, bytes - 1)).toBeGreaterThan(bytes - 1);
  }
});
