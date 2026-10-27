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
