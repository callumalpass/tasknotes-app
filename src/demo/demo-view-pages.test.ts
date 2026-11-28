import { expect, it } from "vitest";
import { DemoTaskRepository } from "./demo-task-repository";

it("keeps whole-board group counts and page snapshots while projecting pages on demand", async () => {
  const repository = new DemoTaskRepository(405);
  const view = (await repository.listViews())
    .flatMap((doc) => doc.views)
    .find((view) => view.id === "work-board")!;
  const full = await repository.executeView(view);
  const iterator = repository
    .iterateView(view, { cumulative: true })
    [Symbol.asyncIterator]();
  const first = (await iterator.next()).value!;
  expect(first.rows).toEqual(full.rows.slice(0, 200));
  expect(first.groups).toEqual(full.groups);
  expect(first.groups.reduce((sum, group) => sum + group.count, 0)).toBe(405);
  first.rows[0]!.task.tags.push("external");
  expect((await repository.cachedViewExecution(view))?.rows).toEqual(
    full.rows.slice(0, 200),
  );
  expect((await iterator.next()).value?.rows).toEqual(full.rows.slice(0, 400));
  const last = (await iterator.next()).value!;
  expect(last.rows).toEqual(full.rows);
  expect(last.hasMore).toBe(false);
  expect((await iterator.next()).done).toBe(true);
});
