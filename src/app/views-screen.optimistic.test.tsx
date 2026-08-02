import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  connectError,
  MdbaseConnectError,
  type JsonObject,
  type MdbaseConnection,
} from "@mdbase-dev/connect";
import { expect, it, vi } from "vitest";

import { shiftTaskDate } from "../domain/task-date-actions";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import { todayString } from "../domain/task";
import { runMdbaseMutation } from "../storage/mdbase-mutation-coordinator";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { RepositoryProvider } from "./repository-context";
import { ViewsScreen } from "./views-screen";

import type { Task } from "../domain/task";
import type { TaskView, TaskViewExecution } from "../domain/view";
import type { TaskRepository } from "../application/ports/task-repository";

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
    <RepositoryProvider
      mutationJournal={new MemoryMutationJournal()}
      repository={repository}
    >
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
  expect(screen.getByRole("alert")).toHaveTextContent(
    "The view change could not finish",
  );
  expect(screen.getByText(/Could not move/)).toBeInTheDocument();
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
    collectionInfo: testCollectionInfo,
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
    <RepositoryProvider
      mutationJournal={new MemoryMutationJournal()}
      repository={repository}
    >
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
    updateMany: async (updates: Parameters<TaskRepository["updateMany"]>[0]) =>
      Promise.all(
        updates.map(({ id, input }) =>
          update(id, input as { sortOrder?: string }),
        ),
      ),
    collectionInfo: testCollectionInfo,
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
    <RepositoryProvider
      mutationJournal={new MemoryMutationJournal()}
      repository={repository}
    >
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
    <RepositoryProvider
      mutationJournal={new MemoryMutationJournal()}
      repository={repository}
    >
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
  const tasks: Task[] = [
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
    updateMany: async (updates: Parameters<TaskRepository["updateMany"]>[0]) =>
      Promise.all(
        updates.map(({ id, input }) =>
          update(id, input as { sortOrder?: string }),
        ),
      ),
    collectionInfo: testCollectionInfo,
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
    <RepositoryProvider
      mutationJournal={new MemoryMutationJournal()}
      repository={repository}
    >
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

it("toggles manual order at the top while preserving fallback sorts", async () => {
  const view = manualListView("toggle");
  view.sort = [
    { property: "note.due", direction: "asc" },
    { property: "note.priority", direction: "desc" },
  ];
  const tasks = [listTask("alpha", "Alpha")];
  let source = {
    path: view.source.path,
    format: "obsidian.base",
    revision: "one",
    document: `views:
  - type: tasknotesTaskList
    name: toggle
    sort:
      - property: note.due
        direction: ASC
      - property: note.priority
        direction: DESC
    options: { create: false }
`,
  };
  const updateViewSource = vi.fn(
    async (input: { path: string; document: string; ifRevision?: string }) => {
      source = { ...source, document: input.document, revision: "two" };
      return source;
    },
  );
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
    executeView: async () => ({
      view,
      rows: tasks.map((task) => ({ task, values: {} })),
      totalCount: tasks.length,
      hasMore: false,
      groups: [],
    }),
    readViewSource: async () => source,
    updateViewSource,
    collectionInfo: testCollectionInfo,
    taskConfiguration: async () => defaultTaskCollectionConfiguration(),
    syncStatus: async () => ({
      mode: "live",
      state: "synced",
      pending: 0,
      issues: 0,
    }),
    syncIssues: async () => [],
  } as unknown as TaskRepository;

  renderListView(repository, view);
  fireEvent.click(
    await screen.findByRole("button", { name: "Turn on manual order" }),
  );

  await screen.findByRole("button", { name: "Turn off manual order" });
  expect(updateViewSource).toHaveBeenCalledOnce();
  expect(source.document.indexOf("note.tasknotes_manual_order")).toBeLessThan(
    source.document.indexOf("note.due"),
  );
  expect(source.document.indexOf("note.due")).toBeLessThan(
    source.document.indexOf("note.priority"),
  );
  expect(
    await screen.findByRole("button", {
      name: "Reorder Alpha. Drag, or use up and down arrow keys.",
    }),
  ).toBeVisible();

  fireEvent.click(
    screen.getByRole("button", { name: "Turn off manual order" }),
  );

  await screen.findByRole("button", { name: "Turn on manual order" });
  expect(updateViewSource).toHaveBeenCalledTimes(2);
  expect(source.document).not.toContain("note.tasknotes_manual_order");
  expect(source.document.indexOf("note.due")).toBeLessThan(
    source.document.indexOf("note.priority"),
  );
  expect(screen.queryByRole("button", { name: /Reorder Alpha/ })).toBeNull();
});

it("moves a task between reusable day sections with the shared list move path", async () => {
  const today = todayString();
  const view = manualListView("day", { sections: "day" });
  const tasks: Task[] = [
    { ...listTask("overdue", "Overdue task"), due: shiftTaskDate(today, -2) },
    { ...listTask("today", "Today task"), due: today },
  ];
  const update = vi.fn(
    async (id: string, input: { due?: string | null; sortOrder?: string }) => {
      const task = tasks.find((candidate) => candidate.id === id)!;
      if (input.due !== undefined) task.due = input.due ?? undefined;
      if (input.sortOrder !== undefined) task.sortOrder = input.sortOrder;
      tasks.sort((left, right) =>
        (right.sortOrder ?? "").localeCompare(left.sortOrder ?? ""),
      );
      return task;
    },
  );
  const repository = manualListRepository(view, tasks, update, () => ({
    view,
    rows: tasks.map((task) => ({ task, values: {} })),
    totalCount: tasks.length,
    hasMore: false,
    groups: [],
  }));

  renderListView(repository, view);
  const handle = await screen.findByRole("button", {
    name: "Reorder Overdue task. Drag, or use up and down arrow keys.",
  });
  const target = screen
    .getByText("Today task")
    .closest<HTMLElement>("[data-manual-order-task]")!;
  mockPointerCapture(handle);
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => target),
  });
  fireEvent.pointerDown(handle, { pointerId: 9 });
  fireEvent.pointerMove(handle, { clientX: 20, clientY: 20, pointerId: 9 });
  fireEvent.pointerUp(handle, { pointerId: 9 });

  await waitFor(() =>
    expect(
      update.mock.calls.some(
        ([id, input]) => id === "overdue" && input.due === today,
      ),
    ).toBe(true),
  );
  await waitFor(() =>
    expect(
      within(screen.getByText("Today").closest("section")!).getByText(
        "Overdue task",
      ),
    ).toBeVisible(),
  );
  expect(screen.getByText("Anytime")).toBeVisible();
  expect(screen.getByText("Later")).toBeVisible();
});

it("moves a grouped list task by mutating the destination property", async () => {
  const view = manualListView("status");
  const tasks = [
    listTask("open", "Open task"),
    { ...listTask("done", "Done task"), status: "done" },
  ];
  const update = vi.fn(
    async (id: string, input: { status?: string; sortOrder?: string }) => {
      const task = tasks.find((candidate) => candidate.id === id)!;
      if (input.status !== undefined) task.status = input.status;
      if (input.sortOrder !== undefined) task.sortOrder = input.sortOrder;
      tasks.sort((left, right) =>
        (right.sortOrder ?? "").localeCompare(left.sortOrder ?? ""),
      );
      return task;
    },
  );
  const execution = (): TaskViewExecution => ({
    view,
    rows: tasks.map((task) => ({ task, values: { status: task.status } })),
    totalCount: tasks.length,
    hasMore: false,
    groups: [...new Set(tasks.map((task) => task.status))].map((status) => ({
      values: { status },
      count: tasks.filter((task) => task.status === status).length,
      summaries: {},
    })),
  });
  const repository = manualListRepository(view, tasks, update, execution, {
    groupBy: "status",
  });

  renderListView(repository, view);
  fireEvent.keyDown(
    await screen.findByRole("button", {
      name: "Reorder Open task. Drag, or use up and down arrow keys.",
    }),
    { key: "ArrowDown" },
  );

  await waitFor(() =>
    expect(
      update.mock.calls.some(
        ([id, input]) => id === "open" && input.status === "done",
      ),
    ).toBe(true),
  );
});

function manualListView(
  id: string,
  options: Record<string, unknown> = {},
): TaskView {
  return {
    key: `views/${id}.base#${id}`,
    documentId: id,
    documentName: id,
    id,
    name: id,
    properties: [],
    source: {
      path: `views/${id}.base`,
      format: "obsidian.base",
      revision: "one",
      writable: true,
    },
    presentation: {
      type: "tasknotes.task-list",
      mappings: {},
      options: { create: false, ...options },
    },
  };
}

function manualListRepository(
  view: TaskView,
  tasks: Task[],
  update: ReturnType<typeof vi.fn>,
  execution: () => TaskViewExecution,
  options: { groupBy?: string } = {},
): TaskRepository {
  return {
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
    name: ${view.name}
${options.groupBy ? `    groupBy: { property: ${options.groupBy}, direction: ASC }\n` : ""}    sort:
      - column: note.tasknotes_manual_order
        direction: DESC
    options: ${JSON.stringify(view.presentation?.options ?? {})}
`,
    }),
    update,
    updateMany: async (updates: Parameters<TaskRepository["updateMany"]>[0]) =>
      Promise.all(
        updates.map(({ id, input }) =>
          (update as unknown as TaskRepository["update"])(id, input),
        ),
      ),
    collectionInfo: testCollectionInfo,
    taskConfiguration: async () => defaultTaskCollectionConfiguration(),
    syncStatus: async () => ({
      mode: "live",
      state: "synced",
      pending: 0,
      issues: 0,
    }),
    syncIssues: async () => [],
  } as unknown as TaskRepository;
}

function renderListView(repository: TaskRepository, view: TaskView) {
  render(
    <RepositoryProvider
      mutationJournal={new MemoryMutationJournal()}
      repository={repository}
    >
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
}

async function testCollectionInfo() {
  return {
    kind: "local" as const,
    id: "optimistic-view-tests",
    name: "Optimistic view tests",
    location: "memory://optimistic-view-tests",
    runtime: "browser" as const,
  };
}

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
  return connectError(
    "operation_outcome_unknown",
    "The direct write may have completed.",
    { operationOutcome: "unknown" },
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
