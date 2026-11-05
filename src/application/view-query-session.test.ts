import { expect, it, vi } from "vitest";
import { ViewQuerySession, appendViewPage } from "./view-query-session";
import { mdbaseError } from "@mdbase-dev/sdk";
import {
  nextTaskFixture,
  seedTask,
  seedTaskView,
} from "../test/next-task-fixture";
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
function fixture(
  iterateView: TaskRepository["iterateView"],
  selectedView: TaskView = view,
) {
  const repository = {
    cachedViewExecution: async () => null,
    readViewSource: async () => ({
      ...view.source,
      document: "views:\n  - type: tasknotesTaskList\n    name: Today\n",
    }),
    iterateView: iterateView
      ? async function* (
          selected: TaskView,
          options?: Parameters<NonNullable<TaskRepository["iterateView"]>>[1],
        ) {
          let cumulative: TaskViewExecution | null = null;
          for await (const page of iterateView(selected, options)) {
            cumulative = appendViewPage(cumulative, page);
            yield options?.cumulative ? cumulative : page;
          }
        }
      : undefined,
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
    session: new ViewQuerySession(repository, selectedView, observer),
  };
}
it("replaces an interrupted partial cursor even when foreground refresh finds no changes", async () => {
  const f = await nextTaskFixture();
  // One more task than the first native window, so the view starts partial.
  for (let index = 0; index <= 200; index++)
    seedTask(f.replica, { title: `Task ${index}` });
  seedTaskView(f.replica, { path: "views/today.base", name: "Today" });
  const repository = f.repository;
  await repository.initialize();
  const selected = (await repository.listViews())[0].views[0];
  selected.presentation = view.presentation;
  const observer = { result: vi.fn(), error: vi.fn(), pending: vi.fn() };
  let session = new ViewQuerySession(repository, selected, observer);
  try {
    await session.start();
    expect(session.currentResult?.rows).toHaveLength(200);
    expect(session.currentResult?.hasMore).toBe(true);
    session.close();
    repository.suspend();
    repository.resume();
    const refreshed = await repository.refresh();
    expect(refreshed.changed).toBe(0);
    // Native view handles belong to their READ cut: rediscover after refresh.
    const current = (await repository.listViews())[0].views[0];
    current.presentation = view.presentation;
    session = new ViewQuerySession(repository, current, observer, 200);
    await session.start();
    expect(session.currentResult?.rows).toHaveLength(200);
    await session.loadMore();
    expect(session.currentResult?.rows).toHaveLength(201);
    expect(observer.error).not.toHaveBeenCalled();
    expect(session.currentResult?.hasMore).toBe(false);
  } finally {
    session.close();
    f.close();
  }
});

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
it("Kanban full load accepts a complete replacement rather than appending a different cut", async () => {
  const selected = {
    ...view,
    presentation: { ...view.presentation!, type: "tasknotes.kanban" },
  };
  const f = fixture(async function* () {
    yield page("unused", false);
  }, selected);
  vi.spyOn(f.repository, "iterateView").mockImplementation(
    async function* (actual, options) {
      expect(actual).toBe(selected);
      expect(options?.cumulative).toBe(true);
      yield { ...page("old-prefix", true), view: selected };
      yield {
        ...page("complete-current-cut", false),
        view: selected,
        totalCount: 1,
      };
    },
  );
  await f.session.start();
  expect(f.session.currentResult?.rows.map(({ task }) => task.id)).toEqual([
    "old-prefix",
  ]);
  expect(await f.session.loadAll()).toBe(true);
  expect(f.session.currentResult?.rows.map(({ task }) => task.id)).toEqual([
    "complete-current-cut",
  ]);
  expect(f.session.currentResult?.totalCount).toBe(1);
  f.session.close();
});
it("Kanban close releases the partial cursor without draining another page", async () => {
  const selected = {
    ...view,
    presentation: { ...view.presentation!, type: "tasknotes.kanban" },
  };
  let reads = 0,
    closed = 0;
  const f = fixture(async function* () {
    try {
      reads++;
      yield page("one", true);
      reads++;
      yield page("two", false);
    } finally {
      closed++;
    }
  }, selected);
  await f.session.start();
  f.session.close();
  await vi.waitFor(() => expect(closed).toBe(1));
  expect(reads).toBe(1);
  expect(f.session.currentResult).toBeNull();
});
it("does not expose lifecycle cancellation as a view failure", async () => {
  const { session, observer } = fixture(async function* () {
    yield page("one", true);
    throw mdbaseError("cancelled", "Neutral diagnostic");
  });
  await session.start();
  await session.loadMore();
  expect(observer.error).not.toHaveBeenCalled();
  expect(session.canLoadMore).toBe(false);
  session.close();
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
