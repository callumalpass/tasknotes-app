import { act, renderHook } from "@testing-library/react";
import type { TaskRepository } from "../application/ports/task-repository";
import type { TaskView, TaskViewExecution } from "../domain/view";
import { registerStartupTiming } from "../observability/startup-timing";
import { useViewExecution } from "./use-view-execution";
const f = vi.hoisted(() => ({
  result: (() => {}) as (result: TaskViewExecution) => void,
  close: vi.fn(),
}));
vi.mock("./repository-context", () => ({ useRepositoryRevision: () => 0 }));
vi.mock("../application/view-query-session", () => ({
  ViewQuerySession: class {
    constructor(
      ...args: [
        TaskRepository,
        TaskView,
        { result(result: TaskViewExecution): void },
      ]
    ) {
      f.result = args[2].result;
    }
    start() {
      return Promise.resolve();
    }
    close() {
      f.close();
    }
    get canLoadMore() {
      return false;
    }
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("does not time stale cache as a query/render and logs once at the first genuine React commit", () => {
  let clock = 0;
  vi.stubGlobal("performance", {
    now: () => clock,
    mark: vi.fn(),
    measure: vi.fn(),
  });
  const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
  const repository = {} as TaskRepository;
  const timing = registerStartupTiming(repository, {
    native_open: 100,
    bootstrap: 90,
  });
  const view = { key: "today", source: { revision: "1" } } as TaskView;
  const reconcile = vi.fn();
  const { unmount } = renderHook(() =>
    useViewExecution(repository, view, "today", "rank", reconcile),
  );
  clock = 5;
  act(() =>
    f.result({ rows: [], stale: true } as unknown as TaskViewExecution),
  );
  expect(timing.has("first_query")).toBe(false);
  expect(debug).not.toHaveBeenCalled();
  clock = 10;
  act(() =>
    f.result({ rows: [], stale: false } as unknown as TaskViewExecution),
  );
  expect(timing.snapshot()).toMatchObject({
    first_query: 10,
    first_render: 0,
    native_open: 100,
  });
  expect(debug).toHaveBeenCalledTimes(1);
  clock = 30;
  act(() =>
    f.result({ rows: [], stale: false } as unknown as TaskViewExecution),
  );
  expect(debug).toHaveBeenCalledTimes(1);
  expect(timing.snapshot().first_query).toBe(10);
  unmount();
});
