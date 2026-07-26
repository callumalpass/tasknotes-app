import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import { RepositoryProvider } from "./repository-context";
import { ViewsScreen } from "./views-screen";

import type { Task } from "../domain/task";
import type { TaskView, TaskViewExecution } from "../domain/view";
import type { TaskRepository } from "../storage/repository";

it("moves a board card immediately and rolls it back when persistence fails", async () => {
  const pending = deferred<Task>();
  const update = vi.fn(() => pending.promise);
  const execution = boardExecution();
  const repository = {
    initialize: async () => undefined,
    refresh: async () => ({
      scanned: 1,
      changed: 0,
      removed: 0,
      elapsedMs: 0,
    }),
    list: async () => [execution.rows[0].task],
    cachedViewExecution: async () => null,
    executeView: async () => execution,
    readViewSource: async () => ({
      path: execution.view.source.path,
      format: "obsidian.base",
      revision: "one",
      document: `views:
  - type: tasknotesKanban
    name: Board
    groupBy: { property: status, direction: ASC }
`,
    }),
    update,
    taskConfiguration: async () => defaultTaskCollectionConfiguration,
    syncStatus: async () => ({
      mode: "live",
      state: "synced",
      pending: 0,
      issues: 0,
    }),
    syncIssues: async () => [],
  } as unknown as TaskRepository;

  render(
    <RepositoryProvider repository={repository}>
      <ViewsScreen
        documents={[
          {
            id: execution.view.documentId,
            name: execution.view.documentName,
            source: execution.view.source,
            views: [execution.view],
          },
        ]}
        navigationViewKeys={[execution.view.key]}
        operational
        viewKey={execution.view.key}
        views={[execution.view]}
        onBack={() => undefined}
        onOpenTask={() => undefined}
        onOpenView={() => undefined}
        onSearch={() => undefined}
        onMoveNavigationView={() => undefined}
        onToggleNavigationView={() => undefined}
        onViewsChanged={async () => undefined}
      />
    </RepositoryProvider>,
  );

  const open = await screen.findByRole("region", { name: "Open column" });
  expect(within(open).getByText("Move on the board")).toBeVisible();

  const inProgress = screen.getByRole("region", {
    name: "In progress column",
  });
  const handle = screen.getByRole("button", {
    name: "Move Move on the board. Drag, or use left and right arrow keys.",
  });
  const board = screen.getByLabelText("Work board");
  Object.defineProperty(handle, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(board, "scrollBy", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => inProgress),
  });

  fireEvent.pointerDown(handle, { pointerId: 7, pointerType: "touch" });
  fireEvent.pointerMove(handle, {
    clientX: 500,
    clientY: 500,
    pointerId: 7,
    pointerType: "touch",
  });
  fireEvent.pointerUp(handle, {
    clientX: 500,
    clientY: 500,
    pointerId: 7,
    pointerType: "touch",
  });

  expect(within(inProgress).getByText("Move on the board")).toBeVisible();
  expect(update).toHaveBeenCalledWith("task-1", { status: "in-progress" });

  await act(async () => pending.reject(new Error("Network lost")));

  await waitFor(() =>
    expect(within(open).getByText("Move on the board")).toBeVisible(),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Could not move");
});

it("shows a cached view while its authoritative result refreshes", async () => {
  const cached = boardExecution();
  const fresh = structuredClone(cached);
  fresh.rows[0].task.title = "Fresh board result";
  const pending = deferred<TaskViewExecution>();
  const repository = {
    initialize: async () => undefined,
    refresh: async () => ({
      scanned: 1,
      changed: 0,
      removed: 0,
      elapsedMs: 0,
    }),
    list: async () => [cached.rows[0].task],
    cachedViewExecution: async () => cached,
    executeView: () => pending.promise,
    readViewSource: async () => ({
      path: cached.view.source.path,
      format: "obsidian.base",
      revision: cached.view.source.revision,
      document: `views:
  - type: tasknotesKanban
    name: Board
    groupBy: { property: status, direction: ASC }
`,
    }),
    taskConfiguration: async () => defaultTaskCollectionConfiguration(),
    syncStatus: async () => ({
      mode: "live",
      state: "synced",
      pending: 0,
      issues: 0,
    }),
    syncIssues: async () => [],
  } as unknown as TaskRepository;

  render(
    <RepositoryProvider repository={repository}>
      <ViewsScreen
        documents={[
          {
            id: cached.view.documentId,
            name: cached.view.documentName,
            source: cached.view.source,
            views: [cached.view],
          },
        ]}
        navigationViewKeys={[cached.view.key]}
        operational
        viewKey={cached.view.key}
        views={[cached.view]}
        onBack={() => undefined}
        onOpenTask={() => undefined}
        onOpenView={() => undefined}
        onSearch={() => undefined}
        onMoveNavigationView={() => undefined}
        onToggleNavigationView={() => undefined}
        onViewsChanged={async () => undefined}
      />
    </RepositoryProvider>,
  );

  expect(await screen.findByText("Move on the board")).toBeVisible();
  expect(screen.getByText("Updating")).toBeVisible();

  await act(async () => pending.resolve(fresh));

  expect(await screen.findByText("Fresh board result")).toBeVisible();
  await waitFor(() =>
    expect(screen.queryByText("Updating")).not.toBeInTheDocument(),
  );
});

function boardExecution(): TaskViewExecution {
  const view: TaskView = {
    key: "views/work.base#board",
    documentId: "work",
    documentName: "work",
    id: "board",
    name: "Work",
    properties: [],
    source: {
      path: "views/work.base",
      format: "obsidian.base",
      revision: "one",
      writable: false,
    },
    presentation: {
      type: "tasknotes.kanban",
      mappings: { column: "status" },
      options: {},
    },
  };
  const task: Task = {
    id: "task-1",
    path: "tasks/task-1.md",
    title: "Move on the board",
    status: "open",
    completed: false,
    archived: false,
    priority: "normal",
    body: "",
    createdAt: "2026-07-23T00:00:00Z",
    updatedAt: "2026-07-23T00:00:00Z",
    tags: [],
    contexts: [],
    projects: [],
    blockedBy: [],
    completeInstances: [],
    skippedInstances: [],
    reminders: [],
    timeEntries: [],
    customProperties: {},
    revision: 1,
    frontmatter: { status: "open" },
  };
  return {
    view,
    rows: [{ task, values: { status: "open" } }],
    totalCount: 1,
    hasMore: false,
    groups: [{ values: { status: "open" }, count: 1, summaries: {} }],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}
