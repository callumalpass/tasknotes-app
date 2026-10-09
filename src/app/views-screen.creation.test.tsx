import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { taskRepositoryStub } from "../test/task-repository-stub";
import { RepositoryProvider } from "./repository-context";
import { ViewsScreen } from "./views-screen";

import type { CreateTaskInput, Task } from "../domain/task";
import type { TaskView, TaskViewExecution } from "../domain/view";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";

it("creates from a saved view with inferred defaults and refreshes the real result", async () => {
  const view = savedView();
  let created: Task | null = null;
  const create = vi.fn(async (input: CreateTaskInput) => {
    created = task(input);
    return created;
  });
  const execution = (): TaskViewExecution => ({
    view,
    rows: created ? [{ task: created, values: {} }] : [],
    totalCount: created ? 1 : 0,
    hasMore: false,
    groups: [],
  });
  const repository = taskRepositoryStub({
    refresh: async () => ({
      scanned: created ? 1 : 0,
      changed: 0,
      removed: 0,
      elapsedMs: 0,
    }),
    list: async () => (created ? [created] : []),
    create,
    cachedViewExecution: async () => null,
    executeView: async () => execution(),
    readViewSource: async () => ({
      path: view.source.path,
      format: "obsidian.base",
      revision: "one",
      document: `views:
  - type: tasknotesTaskList
    name: Work
    filters:
      and:
        - status == "open"
        - projects.contains("mdbase")
`,
    }),
  });

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

  const input = await screen.findByLabelText("New task title");
  const viewSurface = input.closest(".view-detail");
  const emptyResult = screen
    .getByText("No tasks match this view")
    .closest("div");
  expect(viewSurface).toHaveClass("has-list-capture");
  expect(emptyResult).toHaveClass("plain-empty", "task-list-view");
  expect(
    viewSurface?.querySelector(":scope > .capture-composer"),
  ).not.toBeNull();
  expect(viewSurface?.querySelector(":scope > .task-list-view")).toBe(
    emptyResult,
  );

  fireEvent.change(input, { target: { value: "Ship saved-view capture" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  await waitFor(() =>
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Ship saved-view capture",
        status: "open",
        projects: ["mdbase"],
      }),
      expect.objectContaining({ id: expect.any(String) }),
    ),
  );
  expect(await screen.findByText("Ship saved-view capture")).toBeVisible();
  expect(
    screen.queryByText(/this view does not show it/i),
  ).not.toBeInTheDocument();
});

it("uses an explicit declaration selector for read-only view capture metadata (stand-in)", async () => {
  const view = savedView();
  view.documentId = "00000000-0000-0000-0000-000000000001";
  view.id = "1";
  view.key = `${view.documentId}#1`;
  view.source.writable = false;
  view.declaration = {
    recordId: view.documentId,
    path: view.source.path,
    revision: view.source.revision,
    ordinal: 1,
    name: view.name,
  };
  const create = vi.fn(async (input: CreateTaskInput) => task(input));
  const repository = taskRepositoryStub({
    create,
    cachedViewExecution: async () => null,
    executeView: async () => ({
      view,
      rows: [],
      totalCount: 0,
      hasMore: false,
      groups: [],
    }),
    readViewSource: async () => ({
      recordId: view.documentId,
      path: view.source.path,
      format: view.source.format,
      revision: view.source.revision,
      document: `views:
  - name: Work
    type: table
    options:
      create:
        defaults:
          projects: [wrong]
  - name: Work
    type: tasknotesTaskList
    options:
      create:
        defaults:
          projects: [selected]
`,
    }),
  });
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
  const input = await screen.findByLabelText("New task title");
  fireEvent.change(input, { target: { value: "Ordinal capture" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Ordinal capture",
        projects: ["selected"],
      }),
      expect.objectContaining({ id: expect.any(String) }),
    ),
  );
  expect(
    screen.queryByRole("button", { name: "Edit view" }),
  ).not.toBeInTheDocument();
});

function savedView(): TaskView {
  return {
    key: "views/work.base#work",
    documentId: "work",
    documentName: "Work",
    id: "work",
    name: "Work",
    properties: [],
    source: {
      path: "views/work.base",
      format: "obsidian.base",
      revision: "one",
      writable: true,
    },
    presentation: {
      type: "tasknotes.task-list",
      mappings: {},
      options: {},
    },
  };
}

function task(input: CreateTaskInput): Task {
  return {
    id: "created",
    path: "tasks/created.md",
    title: input.title,
    status: input.status ?? "open",
    priority: input.priority ?? "normal",
    completed: false,
    archived: false,
    body: input.body ?? "",
    createdAt: "2026-07-23T00:00:00Z",
    updatedAt: "2026-07-23T00:00:00Z",
    tags: input.tags ?? [],
    contexts: input.contexts ?? [],
    projects: input.projects ?? [],
    attachments: input.attachments ?? [],
    blockedBy: input.blockedBy ?? [],
    completeInstances: [],
    skippedInstances: [],
    reminders: [],
    timeEntries: [],
    customProperties: input.customProperties ?? {},
    revision: 1,
    frontmatter: {
      status: input.status ?? "open",
      projects: input.projects ?? [],
    },
  };
}
