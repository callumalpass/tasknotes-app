import { expect, it, vi } from "vitest";
import { ViewQuerySession, appendViewPage } from "./view-query-session";
import { connectError, connectSuccess } from "@mdbase-dev/connect-testing";
import { MdbaseTaskRepository } from "../storage/mdbase-repository";
import { mdbaseFixture, taskRecord } from "../test/mdbase-fixture";
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
    session: new ViewQuerySession(repository, view, observer),
  };
}
it("replaces an interrupted partial cursor even when foreground refresh finds no changes", async () => {
  const f = mdbaseFixture([taskRecord("one", "One", "r1")]);
  const description = await f.describe();
  description.operations.push("changes");
  f.describe.mockResolvedValue(description);
  Object.assign(f.connect, {
    changes: vi.fn(async () =>
      connectSuccess({
        events: [],
        cursor: description.changeCursor,
        hasMore: false,
        reset: false,
      }),
    ),
  });
  const repository = new MdbaseTaskRepository(f.connect);
  await repository.initialize();
  const selected = (await repository.listViews())[0].views[0];
  selected.presentation = view.presentation;
  const execute = f.executeView.getMockImplementation()!;
  f.executeViewPages.mockImplementation(() =>
    (async function* () {
      const first = await execute();
      yield connectSuccess({
        ...first.result,
        meta: { ...first.result.meta, hasMore: true },
        page: 0,
        offset: 0,
        loaded: 1,
        complete: false,
      });
      yield connectSuccess({
        ...first.result,
        meta: { ...first.result.meta, hasMore: true },
        page: 1,
        offset: 1,
        loaded: 2,
        complete: false,
      });
      yield connectSuccess({
        ...first.result,
        page: 2,
        offset: 2,
        loaded: 3,
        complete: true,
      });
    })(),
  );
  const observer = { result: vi.fn(), error: vi.fn(), pending: vi.fn() };
  let session = new ViewQuerySession(repository, selected, observer);
  let restart = Promise.resolve();
  const unsubscribe = repository.subscribe((change) => {
    if (change?.kind === "status") return;
    const rows = session.currentResult?.rows.length ?? 0;
    session.close();
    session = new ViewQuerySession(repository, selected, observer, rows);
    restart = session.start();
  });
  try {
    await session.start();
    await session.loadMore();
    expect(session.currentResult?.rows).toHaveLength(2);
    repository.suspend();
    repository.resume();
    const refreshed = await repository.refresh();
    expect(refreshed.changed).toBe(0);
    await restart;
    expect(session.currentResult?.rows).toHaveLength(2);
    await session.loadMore();
    expect(observer.error).not.toHaveBeenCalled();
    expect(session.currentResult?.hasMore).toBe(false);
  } finally {
    unsubscribe();
    session.close();
    repository.dispose();
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
it("does not expose lifecycle cancellation as a view failure", async () => {
  const { session, observer } = fixture(async function* () {
    yield page("one", true);
    throw connectError("operation_cancelled", "Neutral diagnostic");
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
