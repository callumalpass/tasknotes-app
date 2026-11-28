import { expect, it } from "vitest";
import { TaskNotesTaskModel } from "../src/domain/tasknotes-model";
import { summarizeToday } from "../src/domain/today-summary";

it("measures 10k task summary decodes and the first Today summary", () => {
  const model = new TaskNotesTaskModel({ timezone: "Pacific/Auckland" });
  const records = Array.from({ length: 10_000 }, (_, index) => ({
    path: `tasks/task-${index}.md`,
    frontmatter: {
      type: "task",
      title: `Task ${index}`,
      status: "open",
      tags: ["task"],
      ...(index % 5 === 0 ? { scheduled: "2026-11-29" } : {}),
      ...(index % 10 === 0 ? { blockedBy: ["[[tasks/Blocker]]"] } : {}),
    },
  }));
  const decodeMs: number[] = [];
  const todayMs: number[] = [];
  for (let run = 0; run < 7; run++) {
    globalThis.gc?.();
    const start = performance.now();
    const tasks = records.map((record) => model.readSummary(record));
    const decoded = performance.now();
    const summary = summarizeToday(tasks, "2026-11-28");
    const finished = performance.now();
    expect(summary.next?.task.id).toBe("tasks/task-0.md");
    expect(summary.completedToday).toBe(0);
    decodeMs.push(decoded - start);
    todayMs.push(finished - decoded);
  }
  const median = (times: number[]) =>
    times.sort((left, right) => left - right)[3]!.toFixed(2);
  console.log(
    `10k hydration medians (7 runs): decode ${median(decodeMs)} ms, Today ${median(todayMs)} ms`,
  );
});
