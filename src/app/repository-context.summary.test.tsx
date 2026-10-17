import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createTestMdbaseRepository, deferred } from "../test/mdbase-fixture";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import type { TaskStats } from "../domain/task";
import {
  RepositoryProvider,
  useCollectionSummary,
  useRepository,
} from "./repository-context";

const counts: TaskStats = { open: 3, total: 5, completed: 2, archived: 0 };

function setup() {
  const repository = createTestMdbaseRepository([]);
  const stats = vi.spyOn(repository, "stats").mockResolvedValue(counts);
  const info = vi.spyOn(repository, "collectionInfo").mockResolvedValue({
    kind: "connect",
    name: "My tasks",
    location: "Live connection through mdbase",
    runtime: "native",
  });
  const journal = new MemoryMutationJournal();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RepositoryProvider repository={repository} mutationJournal={journal}>
      {children}
    </RepositoryProvider>
  );
  return { repository, stats, info, wrapper };
}

function useProbe() {
  return { summary: useCollectionSummary(), context: useRepository() };
}

it("shows collection metadata while statistics are still pending", async () => {
  const fixture = setup();
  const pending = deferred<TaskStats>();
  fixture.stats.mockReturnValue(pending.promise);
  const { result } = renderHook(useProbe, { wrapper: fixture.wrapper });
  await waitFor(() =>
    expect(result.current.summary.info?.name).toBe("My tasks"),
  );
  expect(result.current.summary.loading).toBe(true);
  expect(result.current.summary.stats).toBeNull();
  await act(async () => pending.resolve(counts));
  expect(result.current.summary.loading).toBe(false);
  expect(result.current.summary.stats).toEqual(counts);
});

it("reports failed statistics instead of remaining Opening and retries successfully", async () => {
  const fixture = setup();
  fixture.stats.mockRejectedValueOnce(new Error("Statistics unavailable"));
  const { result } = renderHook(useProbe, { wrapper: fixture.wrapper });
  await waitFor(() =>
    expect(result.current.summary.error?.message).toBe(
      "Statistics unavailable",
    ),
  );
  expect(result.current.summary.loading).toBe(false);
  expect(result.current.summary.info?.name).toBe("My tasks");
  expect(result.current.summary.stats).toBeNull();
  act(() => result.current.summary.retry());
  await waitFor(() => expect(result.current.summary.stats).toEqual(counts));
  expect(result.current.summary.error).toBeNull();
  expect(result.current.summary.loading).toBe(false);
});

it("reports metadata failure independently of successful statistics", async () => {
  const fixture = setup();
  const { result } = renderHook(useProbe, { wrapper: fixture.wrapper });
  await waitFor(() => expect(result.current.summary.stats).toEqual(counts));
  fixture.info.mockRejectedValueOnce(new Error("Metadata unavailable"));
  act(() => result.current.summary.retry());
  await waitFor(() =>
    expect(result.current.summary.error?.message).toBe("Metadata unavailable"),
  );
  expect(result.current.summary.loading).toBe(false);
  expect(result.current.summary.stats).toEqual(counts);
  act(() => result.current.summary.retry());
  await waitFor(() => expect(result.current.summary.error).toBeNull());
  expect(result.current.summary.info?.name).toBe("My tasks");
});

it("retains previous counts but exposes a failed refresh", async () => {
  const fixture = setup();
  const { result } = renderHook(useProbe, { wrapper: fixture.wrapper });
  await waitFor(() => expect(result.current.summary.stats).toEqual(counts));
  fixture.stats.mockRejectedValueOnce(new Error("Refresh failed"));
  act(() =>
    result.current.context.invalidation.invalidate(["collection-summary"]),
  );
  await waitFor(() =>
    expect(result.current.summary.error?.message).toBe("Refresh failed"),
  );
  expect(result.current.summary.stats).toEqual(counts);
  expect(result.current.summary.info?.name).toBe("My tasks");
  expect(result.current.summary.loading).toBe(false);
});

it("ignores an old statistics response after retry replaces it", async () => {
  const fixture = setup();
  const pending = deferred<TaskStats>();
  fixture.stats.mockReturnValueOnce(pending.promise);
  const { result } = renderHook(useProbe, { wrapper: fixture.wrapper });
  await waitFor(() =>
    expect(result.current.summary.info?.name).toBe("My tasks"),
  );
  act(() => result.current.summary.retry());
  await waitFor(() => expect(result.current.summary.stats).toEqual(counts));
  await act(async () => pending.resolve({ ...counts, total: 99 }));
  expect(result.current.summary.stats).toEqual(counts);
  expect(result.current.summary.error).toBeNull();
});
