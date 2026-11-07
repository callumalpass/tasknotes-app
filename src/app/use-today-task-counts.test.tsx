import { act, cleanup, render, screen } from "../test/render";
import { afterEach, expect, it, vi } from "vitest";
import { useTodayTaskCounts } from "./use-today-task-counts";
import type { TodayTaskCounts } from "../domain/today-summary";

const fixture = vi.hoisted(() => ({
  counts: null as TodayTaskCounts | null,
  listeners: new Set<() => void>(),
  reads: vi.fn(),
}));
const repository = {
  todayTaskCounts: () => fixture.counts,
  subscribe(listener: () => void) {
    fixture.listeners.add(listener);
    return () => fixture.listeners.delete(listener);
  },
  listSummaries: fixture.reads,
  stats: fixture.reads,
  executeView: fixture.reads,
};
vi.mock("./repository-context", () => ({
  useRepository: () => ({ repository, status: "ready" }),
}));
afterEach(() => {
  cleanup();
  fixture.counts = null;
  fixture.reads.mockClear();
});

function Badge() {
  const counts = useTodayTaskCounts();
  return (
    <output>{counts ? `${counts.total}/${counts.overdue}` : "unknown"}</output>
  );
}

it("waits for complete metadata and observes changes without starting reads", () => {
  render(<Badge />);
  expect(screen.getByRole("status")).toHaveTextContent("unknown");
  act(() => {
    fixture.counts = { total: 14, overdue: 12 };
    for (const listener of fixture.listeners) listener();
  });
  expect(screen.getByRole("status")).toHaveTextContent("14/12");
  act(() => {
    fixture.counts = { total: 13, overdue: 11 };
    for (const listener of fixture.listeners) listener();
  });
  expect(screen.getByRole("status")).toHaveTextContent("13/11");
  expect(fixture.reads).not.toHaveBeenCalled();
});
