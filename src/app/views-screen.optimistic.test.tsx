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
    executeView: async () => execution,
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
        operational
        viewKey={execution.view.key}
        views={[execution.view]}
        onBack={() => undefined}
        onOpenTask={() => undefined}
        onOpenView={() => undefined}
        onSearch={() => undefined}
        onSetPrimaryView={() => undefined}
        onViewsChanged={async () => undefined}
      />
    </RepositoryProvider>,
  );

  const open = await screen.findByRole("region", { name: "Open column" });
  expect(within(open).getByText("Move on the board")).toBeVisible();

  fireEvent.keyDown(
    screen.getByRole("button", {
      name: "Move Move on the board. Use left and right arrow keys, or drag.",
    }),
    { key: "ArrowRight" },
  );

  const inProgress = screen.getByRole("region", {
    name: "In progress column",
  });
  expect(within(inProgress).getByText("Move on the board")).toBeVisible();
  expect(update).toHaveBeenCalledWith("task-1", { status: "in-progress" });

  await act(async () => pending.reject(new Error("Network lost")));

  await waitFor(() =>
    expect(within(open).getByText("Move on the board")).toBeVisible(),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Could not move");
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
