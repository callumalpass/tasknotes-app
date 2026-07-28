import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  MdbaseConnectError,
  type JsonObject,
  type MdbaseConnection,
} from "@mdbase/connect";
import { expect, it, vi } from "vitest";

import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import { runMdbaseMutation } from "../storage/mdbase-mutation-coordinator";
import { RepositoryProvider } from "./repository-context";
import { ViewsScreen } from "./views-screen";

import type { Task } from "../domain/task";
import type { TaskView, TaskViewExecution } from "../domain/view";
import type { TaskRepository } from "../storage/repository";

it("moves a board card immediately and rolls it back when persistence fails", async () => {
  const pending = deferred<Task>();
  const update = vi.fn(() => pending.promise);
  const execution = boardExecution();
  const openTask = vi.fn();
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
        onOpenTask={openTask}
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
  expect(document.querySelector(".kanban-drag-handle")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Move cards between columns" }),
  ).not.toBeInTheDocument();
  const card = screen.getByRole("group", {
    name: "Move on the board. Drag to move between columns. Use left and right arrow keys.",
  });
  const title = within(card).getByRole("button", {
    name: "Move on the board",
  });
  fireEvent.click(title);
  expect(openTask).toHaveBeenCalledWith(execution.rows[0].task, undefined);
  openTask.mockClear();

  const completion = within(card).getByRole("button", {
    name: "Complete Move on the board",
  });
  fireEvent.pointerDown(completion, {
    button: 0,
    isPrimary: true,
    pointerId: 6,
    pointerType: "mouse",
  });
  fireEvent.pointerMove(completion, {
    clientX: 500,
    clientY: 500,
    isPrimary: true,
    pointerId: 6,
    pointerType: "mouse",
  });
  fireEvent.pointerUp(completion, {
    clientX: 500,
    clientY: 500,
    isPrimary: true,
    pointerId: 6,
    pointerType: "mouse",
  });
  expect(update).not.toHaveBeenCalled();

  const board = screen.getByLabelText("Work board");
  mockPointerCapture(card);
  Object.defineProperty(window, "scrollBy", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => inProgress),
  });

  fireEvent.pointerDown(card, {
    button: 0,
    isPrimary: true,
    pointerId: 7,
    pointerType: "mouse",
  });
  fireEvent.pointerMove(card, {
    clientX: 500,
    clientY: 500,
    isPrimary: true,
    pointerId: 7,
    pointerType: "mouse",
  });
  fireEvent.pointerUp(card, {
    clientX: 500,
    clientY: 500,
    isPrimary: true,
    pointerId: 7,
    pointerType: "mouse",
  });
  fireEvent.click(title);
  expect(openTask).not.toHaveBeenCalled();

  const movedTitle = await within(inProgress).findByText("Move on the board");
  expect(movedTitle).toBeVisible();
  expect(movedTitle.closest(".kanban-card")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  expect(board).toHaveAttribute("aria-busy", "true");
  expect(update).toHaveBeenCalledWith("task-1", { status: "in-progress" });

  await act(async () => pending.reject(new Error("Network lost")));

  await waitFor(() =>
    expect(within(open).getByText("Move on the board")).toBeVisible(),
  );
  expect(board).toHaveAttribute("aria-busy", "false");
  expect(screen.getByRole("alert")).toHaveTextContent("Could not move");
});

it("recovers an uncertain manual board write before sending the queued move", async () => {
  const pending = deferred<void>();
  const connection = {} as MdbaseConnection<JsonObject>;
  const execution = boardExecution();
  const queued = listTask("task-2", "Move next");
  const stationary = listTask("task-3", "Stay in place");
  execution.rows.push(
    { task: queued, values: { status: "open" } },
    { task: stationary, values: { status: "open" } },
  );
  execution.totalCount = 3;
  execution.groups[0].count = 3;
  let attempt = 0;
  const providerUpdate = vi.fn(
    async (id: string, input: { sortOrder?: string; status?: string }) => {
      attempt += 1;
      if (attempt === 1) throw unknownOutcome();
      if (attempt === 2) await pending.promise;
      const row = execution.rows.find(({ task }) => task.id === id)!;
      if (input.sortOrder !== undefined) {
        row.task.sortOrder = input.sortOrder;
        row.task.frontmatter.tasknotes_manual_order = input.sortOrder;
      }
      if (input.status !== undefined) {
        row.task.status = input.status;
        row.task.frontmatter.status = input.status;
        row.values.status = input.status;
      }
      return row.task;
    },
  );
  const update = vi.fn(
    (id: string, input: { sortOrder?: string; status?: string }) =>
      runMdbaseMutation(connection, () => providerUpdate(id, input)),
  );
  const updateMany = vi.fn(
    async (
      updates: readonly {
        id: string;
        input: { sortOrder?: string; status?: string };
      }[],
    ) => {
      const tasks: Task[] = [];
      for (const { id, input } of updates) tasks.push(await update(id, input));
      return tasks;
    },
  );
  const repository = {
    initialize: async () => undefined,
    refresh: async () => ({
      scanned: 2,
      changed: 0,
      removed: 0,
      elapsedMs: 0,
    }),
    list: async () => execution.rows.map(({ task }) => task),
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
    sort:
      - column: note.tasknotes_manual_order
        direction: DESC
`,
    }),
    update,
    updateMany,
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

  expect(
    screen.queryByRole("button", { name: "Arrange cards" }),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(
    await screen.findByRole("group", {
      name: /Move on the board\. Drag to move\. Use arrow keys to arrange\./,
    }),
    { key: "ArrowRight" },
  );
  fireEvent.keyDown(
    screen.getByRole("group", {
      name: /Move next\. Drag to move\. Use arrow keys to arrange\./,
    }),
    { key: "ArrowRight" },
  );

  const inProgress = screen.getByRole("region", {
    name: "In progress column",
  });
  const movedCard = within(inProgress)
    .getByText("Move on the board")
    .closest(".kanban-card");
  const queuedCard = within(inProgress)
    .getByText("Move next")
    .closest(".kanban-card");
  const stationaryCard = screen
    .getByText("Stay in place")
    .closest(".kanban-card");
  expect(movedCard).toHaveAttribute("aria-busy", "true");
  expect(movedCard).toHaveClass("is-pending");
  expect(queuedCard).toHaveAttribute("aria-busy", "true");
  expect(queuedCard).toHaveClass("is-pending");
  expect(stationaryCard).toHaveAttribute("aria-busy", "false");
  expect(stationaryCard).not.toHaveClass("is-pending");
  await waitFor(() => expect(providerUpdate).toHaveBeenCalledTimes(2));
  expect(providerUpdate.mock.calls[1]).toEqual(providerUpdate.mock.calls[0]);
  expect(providerUpdate.mock.calls[1]![1]).toBe(
    providerUpdate.mock.calls[0]![1],
  );

  await act(async () => pending.resolve());
  await waitFor(() =>
    expect(screen.getByLabelText("Work board")).toHaveAttribute(
      "aria-busy",
      "false",
    ),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(providerUpdate.mock.calls.at(-1)?.[0]).toBe("task-2");
  expect(updateMany).toHaveBeenCalledTimes(2);
});

it("serializes rapid consecutive board moves without rejecting the second move", async () => {
  const first = deferred<Task>();
  const second = deferred<Task>();
  const update = vi
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise);
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

  fireEvent.keyDown(
    await screen.findByRole("group", {
      name: /Move on the board\. Drag to move between columns\./,
    }),
    { key: "ArrowRight" },
  );
  const inProgress = screen.getByRole("region", {
    name: "In progress column",
  });
  fireEvent.keyDown(
    await within(inProgress).findByRole("group", {
      name: /Move on the board\. Drag to move between columns\./,
    }),
    { key: "ArrowRight" },
  );

  expect(
    within(screen.getByRole("region", { name: "Done column" })).getByText(
      "Move on the board",
    ),
  ).toBeVisible();
  expect(update).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenNthCalledWith(1, "task-1", {
    status: "in-progress",
  });

  await act(async () => first.resolve(execution.rows[0].task));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  expect(update).toHaveBeenNthCalledWith(2, "task-1", { status: "done" });

  await act(async () => second.resolve(execution.rows[0].task));
  await waitFor(() =>
    expect(screen.getByLabelText("Work board")).toHaveAttribute(
      "aria-busy",
      "false",
    ),
  );
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
  expect(screen.getByText("Updating view")).toHaveClass("visually-hidden");

  await act(async () => pending.resolve(fresh));

  expect(await screen.findByText("Fresh board result")).toBeVisible();
  await waitFor(() =>
    expect(screen.queryByText("Updating view")).not.toBeInTheDocument(),
  );
});

it("reorders a manual task list with keyboard-accessible handles", async () => {
  const view: TaskView = {
    key: "views/manual.base#manual",
    documentId: "manual",
    documentName: "manual",
    id: "manual",
    name: "Manual",
    properties: [],
    source: {
      path: "views/manual.base",
      format: "obsidian.base",
      revision: "one",
      writable: true,
    },
    presentation: {
      type: "tasknotes.task-list",
      mappings: {},
      options: { create: false },
    },
  };
  const tasks = [
    listTask("alpha", "Alpha"),
    listTask("bravo", "Bravo"),
    listTask("charlie", "Charlie"),
  ];
  const execution = (): TaskViewExecution => ({
    view,
    rows: tasks.map((task) => ({ task, values: {} })),
    totalCount: tasks.length,
    hasMore: false,
    groups: [],
  });
  const update = vi.fn(async (id: string, input: { sortOrder?: string }) => {
    const task = tasks.find((candidate) => candidate.id === id)!;
    task.sortOrder = input.sortOrder;
    task.frontmatter.tasknotes_manual_order = input.sortOrder;
    tasks.sort((left, right) =>
      (right.sortOrder ?? "").localeCompare(left.sortOrder ?? ""),
    );
    return task;
  });
  const repository = {
    initialize: async () => undefined,
    refresh: async () => ({
      scanned: tasks.length,
      changed: 0,
      removed: 0,
      elapsedMs: 0,
    }),
    list: async () => tasks,
    cachedViewExecution: async () => null,
    executeView: async () => execution(),
    readViewSource: async () => ({
      path: view.source.path,
      format: "obsidian.base",
      revision: "one",
      document: `views:
  - type: tasknotesTaskList
    name: Manual
    sort:
      - column: note.tasknotes_manual_order
        direction: DESC
    options: { create: false }
`,
    }),
    update,
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
            id: view.documentId,
            name: view.documentName,
            source: view.source,
            views: [view],
          },
        ]}
        navigationViewKeys={[view.key]}
        operational
        viewKey={view.key}
        views={[view]}
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

  expect(
    screen.queryByRole("button", {
      name: "Reorder Charlie. Drag, or use up and down arrow keys.",
    }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Reorder tasks",
    }),
  );
  const handle = await screen.findByRole("button", {
    name: "Reorder Charlie. Drag, or use up and down arrow keys.",
  });
  fireEvent.keyDown(handle, { key: "ArrowUp" });

  await waitFor(() => expect(update).toHaveBeenCalledTimes(3));
  expect(
    update.mock.calls.every(([, input]) =>
      /^tn[a-z]{10}$/.test(input.sortOrder ?? ""),
    ),
  ).toBe(true);
  await waitFor(() => {
    const labels = screen
      .getAllByRole("button", { name: /Reorder .+ Drag/ })
      .map((button) => button.getAttribute("aria-label"));
    expect(labels).toEqual([
      "Reorder Alpha. Drag, or use up and down arrow keys.",
      "Reorder Charlie. Drag, or use up and down arrow keys.",
      "Reorder Bravo. Drag, or use up and down arrow keys.",
    ]);
  });
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

function listTask(id: string, title: string): Task {
  return {
    id,
    path: `tasks/${id}.md`,
    title,
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

function unknownOutcome(): MdbaseConnectError {
  return new MdbaseConnectError(
    "direct_outcome_unknown",
    "The direct write may have completed.",
  );
}

function mockPointerCapture(element: HTMLElement) {
  Object.defineProperties(element, {
    hasPointerCapture: {
      configurable: true,
      value: vi.fn(() => true),
    },
    releasePointerCapture: {
      configurable: true,
      value: vi.fn(),
    },
    setPointerCapture: {
      configurable: true,
      value: vi.fn(),
    },
  });
}
