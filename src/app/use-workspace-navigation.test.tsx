import { act, renderHook } from "@testing-library/react";

import { useWorkspaceNavigation } from "./use-workspace-navigation";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

it("keeps one panel entry when choosing another task", () => {
  window.history.replaceState(null, "", "/");
  const { result } = renderHook(() => useWorkspaceNavigation([]));
  const start = window.history.length;

  act(() => result.current.navigate({ page: "task", id: "tasks/a.md" }));
  act(() => result.current.navigate({ page: "task", id: "tasks/b.md" }));
  act(() => result.current.navigate({ page: "task", id: "tasks/c.md" }));

  expect(window.history.length).toBe(start + 1);
  expect(window.history.state).toEqual({ taskPanel: true });
  expect(result.current.route).toEqual({ page: "task", id: "tasks/c.md" });
  expect(result.current.workspaceRoute).toEqual({ page: "home" });
});

it("does not mark a directly opened task as covering the workspace", () => {
  window.history.replaceState(null, "", "/task/tasks%2Fa.md");
  const { result } = renderHook(() => useWorkspaceNavigation([]));

  act(() => result.current.navigate({ page: "task", id: "tasks/b.md" }));

  expect(window.history.state).toEqual({ taskPanel: false });
});

it("freezes the opening list order, preserves occurrences, and keeps it while browsing", () => {
  const { result } = renderHook(() => useWorkspaceNavigation([]));
  const order = [
    { id: "b" },
    { id: "a", occurrence: "2026-11-04" },
    { id: "a", occurrence: "2026-11-05" },
  ];
  act(() => result.current.navigate({ page: "task", id: "b" }, false, order));
  expect(result.current.taskOrder).toEqual(order);
  act(() =>
    result.current.navigate({
      page: "task",
      id: "a",
      occurrence: "2026-11-04",
    }),
  );
  expect(result.current.taskOrder).toEqual(order);
  act(() => result.current.navigate({ page: "home" }));
  expect(result.current.taskOrder).toEqual([]);
});

it("uses reading order for small rendered lists and excludes hidden rows", () => {
  const root = document.createElement("main");
  root.id = "main-content";
  root.innerHTML =
    '<div class="task-row" data-task-id="b"></div><div hidden><div class="task-row" data-task-id="hidden"></div></div><div class="task-row" data-task-id="a" data-occurrence="2026-11-04"></div>';
  document.body.append(root);
  try {
    const { result } = renderHook(() => useWorkspaceNavigation([]));
    act(() => result.current.navigate({ page: "task", id: "b" }));
    expect(result.current.taskOrder).toEqual([
      { id: "b" },
      { id: "a", occurrence: "2026-11-04" },
    ]);
  } finally {
    root.remove();
  }
});
