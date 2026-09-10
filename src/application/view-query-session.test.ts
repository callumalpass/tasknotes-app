import { expect, it, vi } from "vitest";
import { ViewQuerySession } from "./view-query-session";
import type { TaskRepository } from "./ports/task-repository";
import type { TaskView, TaskViewExecution } from "../domain/view";
const view: TaskView = {
  key: "views/today.base#today",
  documentId: "today",
  documentName: "Today",
  id: "today",
  name: "Today",
  properties: [],
  source: {
    path: "views/today.base",
    format: "obsidian.base",
    revision: "1",
    writable: true,
  },
  presentation: { type: "tasknotes.task-list", mappings: {}, options: {} },
};
function page(id: string, hasMore: boolean): TaskViewExecution {
  return {
    view,
    rows: [
      { task: { id } as TaskViewExecution["rows"][number]["task"], values: {} },
    ],
    groups: [],
    totalCount: 2,
    hasMore,
  };
}
function fixture(iterateView: TaskRepository["iterateView"]) {
  const repository = {
    cachedViewExecution: async () => null,
    readViewSource: async () => ({
      ...view.source,
      document: "views:\n  - type: tasknotesTaskList\n    name: Today\n",
    }),
    iterateView,
    executeView: vi.fn(async () => page("complete", false)),
  } as unknown as TaskRepository;
  const observer = {
    result: vi.fn<(execution: TaskViewExecution) => void>(),
    error: vi.fn(),
    pending: vi.fn(),
  };
  return {
    repository,
    observer,
    session: new ViewQuerySession(repository, view, observer),
  };
}
it("paints the first page without draining later pages, joins load-more, and closes the cursor", async () => {
  let requests = 0,
    released = 0;
  const { session, observer } = fixture(async function* () {
    try {
      requests++;
      yield page("one", true);
      requests++;
      yield page("two", false);
    } finally {
      released++;
    }
  });
  await session.start();
  expect(requests).toBe(1);
  expect(observer.result).toHaveBeenLastCalledWith(
    expect.objectContaining({ hasMore: true, totalCount: 2 }),
  );
  const next = session.loadMore();
  expect(session.loadMore()).toBe(next);
  await next;
  expect(requests).toBe(2);
  expect(released).toBe(1);
  expect(
    observer.result.mock.lastCall?.[0].rows.map((row) => row.task.id),
  ).toEqual(["one", "two"]);
});
it("retains partial results as stale and exposes a page failure without replaying the cursor", async () => {
  const { session, observer } = fixture(async function* () {
    yield page("one", true);
    throw new Error("Page unavailable");
  });
  await session.start();
  await session.loadMore();
  expect(observer.error).toHaveBeenCalledWith(
    expect.objectContaining({ message: "Page unavailable" }),
  );
  expect(observer.result.mock.lastCall?.[0]).toMatchObject({
    stale: true,
    hasMore: true,
  });
  expect(session.canLoadMore).toBe(false);
  session.close();
});
it("does not publish a late page after the view has closed", async () => {
  let release!: () => void;
  let freed = false;
  const { session, observer } = fixture(async function* () {
    try {
      yield page("one", true);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      yield page("two", false);
    } finally {
      freed = true;
    }
  });
  await session.start();
  const next = session.loadMore();
  await Promise.resolve();
  session.close();
  release();
  await next;
  expect(observer.result).toHaveBeenCalledTimes(1);
  expect(observer.error).not.toHaveBeenCalled();
  expect(freed).toBe(true);
});
it("does not silently call a truncated iterator complete", async () => {
  const { session, observer } = fixture(async function* () {
    yield page("one", true);
  });
  await session.start();
  await session.loadMore();
  expect(observer.error).toHaveBeenCalledOnce();
  expect(observer.result.mock.lastCall?.[0]).toMatchObject({
    hasMore: true,
    stale: true,
  });
});
it("loads the complete scope only on explicit request and restarts without duplicate rows", async () => {
  let requests = 0;
  const { session, repository, observer } = fixture(async function* () {
    requests++;
    yield page("one", true);
    requests++;
    yield page("two", false);
  });
  await session.start();
  expect(requests).toBe(1);
  expect(await session.loadAll()).toBe(true);
  expect(requests).toBe(2);
  await session.start();
  expect(
    observer.result.mock.lastCall?.[0].rows.map((row) => row.task.id),
  ).toEqual(["one", "two"]);
  expect(repository.executeView).not.toHaveBeenCalled();
});
it("does not let a late cached result erase a fresh failure", async () => {
  const { session, repository, observer } = fixture(undefined);
  let resolve!: (value: TaskViewExecution) => void;
  repository.cachedViewExecution = () =>
    new Promise((done) => {
      resolve = done;
    });
  repository.executeView = vi.fn().mockRejectedValue(new Error("Offline"));
  await session.start();
  resolve(page("old", false));
  await Promise.resolve();
  expect(observer.error).toHaveBeenCalledOnce();
  expect(observer.result).not.toHaveBeenCalled();
});
