import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import { RepositoryProvider } from "./repository-context";
import { ViewsScreen } from "./views-screen";

import type { CreateTaskInput, Task } from "../domain/task";
import type { TaskView, TaskViewExecution } from "../domain/view";
import type { TaskRepository } from "../storage/repository";

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
  const repository = {
    initialize: async () => undefined,
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

  const input = await screen.findByLabelText("New task title");
  const viewSurface = input.closest(".view-detail");
  const emptyResult = screen.getByText("Nothing here").closest("div");
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
    ),
  );
  expect(await screen.findByText("Ship saved-view capture")).toBeVisible();
  expect(
    screen.queryByText(/this view does not show it/i),
  ).not.toBeInTheDocument();
});

it("marks an empty saved view as incomplete while local tasks are indexing", async () => {
  const view = savedView();
  const repository = {
    initialize: async () => undefined,
    refresh: async () => ({
      scanned: 300,
      changed: 300,
      removed: 0,
      elapsedMs: 500,
    }),
    indexingProgress: () => ({
      phase: "indexing",
      completed: 64,
      total: 300,
      complete: false,
    }),
    collectionInfo: async () => ({
      kind: "local",
      name: "Test collection",
      location: "test",
      runtime: "browser",
    }),
    list: async () => [],
    cachedViewExecution: async () => null,
    executeView: async (): Promise<TaskViewExecution> => ({
      view,
      rows: [],
      records: [],
      totalCount: 0,
      hasMore: false,
      groups: [],
    }),
    readViewSource: async () => ({
      path: view.source.path,
      format: "obsidian.base",
      revision: "one",
      document: "views:\n  - type: tasknotesTaskList\n    name: Work\n",
    }),
    taskConfiguration: async () => defaultTaskCollectionConfiguration(),
    syncStatus: async () => ({
      mode: "local",
      state: "local",
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

  expect(await screen.findByText("Indexing your tasks")).toBeVisible();
  expect(
    screen.getByText("Matching tasks will appear as they are found."),
  ).toBeVisible();
  expect(screen.queryByText("Nothing here")).not.toBeInTheDocument();
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
