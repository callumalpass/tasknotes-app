import { connectSuccess } from "@mdbase-dev/connect-testing";
import { expect, it } from "vitest";
import { ViewQuerySession } from "../application/view-query-session";
import { deferred, mdbaseFixture, taskRecord } from "../test/mdbase-fixture";
import { MdbaseTaskRepository } from "./mdbase-repository";
import type { TaskView } from "../domain/view";

async function fixture() {
  const f = mdbaseFixture([taskRecord("one", "One", "r1")]);
  const repository = new MdbaseTaskRepository(f.connect);
  await repository.initialize();
  const view = (await repository.listViews())[0].views[0];
  return { ...f, repository, view };
}

it("retains only the last source revision for a view identity", async () => {
  const f = await fixture();
  const views: TaskView[] = [];
  for (let i = 0; i < 64; i++) {
    const view = {
      ...f.view,
      source: { ...f.view.source, revision: String(i) },
    };
    views.push(view);
    await f.repository.executeView(view);
  }
  const retained = await Promise.all(
    views.map((view) => f.repository.cachedViewExecution(view)),
  );
  expect(retained.filter(Boolean)).toHaveLength(1);
  expect(retained.at(-1)?.rows).toHaveLength(1);
});

it("bounds retention across live identities without truncating executions", async () => {
  const f = await fixture();
  const views = Array.from({ length: 32 }, (_, i) => ({
    ...f.view,
    key: `view-${i}`,
  }));
  for (const view of views)
    expect((await f.repository.executeView(view)).rows).toHaveLength(1);
  const retained = await Promise.all(
    views.map((view) => f.repository.cachedViewExecution(view)),
  );
  expect(retained.filter(Boolean)).toHaveLength(16);
  expect(retained.slice(0, 16)).toEqual(Array(16).fill(null));
});

it("bounds retained bytes even for fewer than sixteen views", async () => {
  const f = await fixture();
  const execute = f.executeView.getMockImplementation()!;
  f.executeViewPages.mockImplementation(() =>
    (async function* () {
      const page = await execute();
      Object.assign(page.result.results[0].values, {
        long: "x".repeat(1024 * 1024),
      });
      yield connectSuccess({
        ...page.result,
        page: 0,
        offset: 0,
        loaded: 1,
        complete: true,
      });
    })(),
  );
  const views = Array.from({ length: 4 }, (_, i) => ({
    ...f.view,
    key: `large-${i}`,
  }));
  for (const view of views)
    expect((await f.repository.executeView(view)).rows).toHaveLength(1);
  const retained = await Promise.all(
    views.map((view) => f.repository.cachedViewExecution(view)),
  );
  expect(retained.filter(Boolean).length).toBeLessThanOrEqual(1);
  expect(retained.at(-1)).not.toBeNull();
});

it("does not let a late old-revision read displace the newest retained revision", async () => {
  const f = await fixture();
  const gate = deferred<void>();
  const execute = f.executeView.getMockImplementation()!;
  f.executeViewPages.mockImplementationOnce(() =>
    (async function* () {
      await gate.promise;
      const page = await execute();
      yield connectSuccess({
        ...page.result,
        page: 0,
        offset: 0,
        loaded: 1,
        complete: true,
      });
    })(),
  );
  const old = f.repository.executeView(f.view);
  const newer = { ...f.view, source: { ...f.view.source, revision: "newer" } };
  await f.repository.executeView(newer);
  gate.resolve();
  await old;
  expect(await f.repository.cachedViewExecution(newer)).not.toBeNull();
  expect(await f.repository.cachedViewExecution(f.view)).toBeNull();
});

it("lets the query session consume the adapter's cumulative snapshot without copying a second prefix", async () => {
  const f = await fixture();
  f.view.presentation = {
    type: "tasknotes.task-list",
    mappings: {},
    options: {},
  };
  const execute = f.executeView.getMockImplementation()!;
  f.executeViewPages.mockImplementation(() =>
    (async function* () {
      const first = await execute();
      for (let i = 0; i < 2; i++)
        yield connectSuccess({
          ...first.result,
          meta: { ...first.result.meta, hasMore: i === 0 },
          page: i,
          offset: i,
          loaded: i + 1,
          complete: i === 1,
        });
    })(),
  );
  const iterate = f.repository.iterateView.bind(f.repository);
  const yielded: unknown[] = [];
  f.repository.iterateView = async function* (view, options) {
    for await (const execution of iterate(view, options)) {
      yielded.push(execution);
      yield execution;
    }
  };
  const session = new ViewQuerySession(f.repository, f.view, {
    result: () => {},
    error: (reason) => {
      throw reason;
    },
    pending: () => {},
  });
  try {
    await session.start();
    await session.loadMore();
    expect(session.currentResult?.rows).toHaveLength(2);
    expect(session.currentResult).toBe(yielded[1]);
  } finally {
    session.close();
  }
});
