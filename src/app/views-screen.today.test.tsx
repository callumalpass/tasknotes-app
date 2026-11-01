import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "../test/render";
import { expect, it, vi } from "vitest";

import { shiftTaskDate } from "../domain/task-date-actions";
import { todayString } from "../domain/task";
import { taskRepositoryStub } from "../test/task-repository-stub";
import { deferred } from "../test/deferred";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { RepositoryProvider } from "./repository-context";
import { ViewsScreen } from "./views-screen";

import type { Task, UpdateTaskInput } from "../domain/task";
import type { TaskView } from "../domain/view";
import type { TaskRepository } from "../application/ports/task-repository";

it("moves every overdue task to today in one batch and offers Undo", async () => {
  const today = todayString();
  const tasks: Task[] = [
    task("late-scheduled", "Late scheduled", {
      scheduled: `${shiftTaskDate(today, -3)}T09:30`,
      due: shiftTaskDate(today, 4),
    }),
    task("late-due", "Late due", { due: shiftTaskDate(today, -1) }),
    task("current", "Current", { scheduled: today }),
  ];
  const write = deferred<void>();
  const updateMany = vi.fn<TaskRepository["updateMany"]>(async (updates) => {
    await write.promise;
    return updates.map(({ id, input }) => apply(tasks, id, input));
  });
  renderToday(repository(tasks, { updateMany }));

  const action = await screen.findByRole("button", {
    name: "Move all to today, 2 overdue tasks",
  });
  expect(action.closest("h2")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Overdue 2" }).closest("h2"),
  ).not.toBeNull();
  fireEvent.click(action);

  // Rows move before the batch is accepted.
  const todaySection = () =>
    screen.getByRole("button", { name: /^Today \d+$/ }).closest("section")!;
  expect(within(todaySection()).getByText("Late scheduled")).toBeVisible();
  expect(within(todaySection()).getByText("Late due")).toBeVisible();
  expect(screen.queryByRole("button", { name: /^Overdue/ })).toBeNull();
  await waitFor(() =>
    expect(updateMany).toHaveBeenCalledWith([
      { id: "late-scheduled", input: { scheduled: `${today}T09:30` } },
      { id: "late-due", input: { scheduled: today } },
    ]),
  );

  await act(async () => write.resolve());
  const undo = await screen.findByRole("button", { name: "Undo" });
  expect(screen.getByText("Moved 2 tasks to today")).toBeVisible();
  await waitFor(() => expect(undo).toHaveFocus());
  // Due-only tasks keep their deadline; only Scheduled changed.
  expect(tasks[1].due).toBe(shiftTaskDate(today, -1));

  fireEvent.click(undo);
  await waitFor(() =>
    expect(updateMany).toHaveBeenLastCalledWith([
      {
        id: "late-scheduled",
        input: { scheduled: `${shiftTaskDate(today, -3)}T09:30` },
      },
      { id: "late-due", input: { scheduled: null } },
    ]),
  );
  const overdue = await screen.findByRole("button", { name: "Overdue 2" });
  expect(
    within(overdue.closest("section")!).getByText("Late due"),
  ).toBeVisible();
  expect(screen.queryByText("Moved 2 tasks to today")).toBeNull();
});

it("returns rows to Overdue when the batch is rejected", async () => {
  const today = todayString();
  const tasks = [task("late", "Late", { scheduled: shiftTaskDate(today, -2) })];
  renderToday(
    repository(tasks, {
      updateMany: async () => {
        throw new Error("The collection is read-only.");
      },
    }),
  );

  fireEvent.click(
    await screen.findByRole("button", {
      name: "Move all to today, 1 overdue task",
    }),
  );

  const overdue = await screen.findByRole("button", { name: "Overdue 1" });
  expect(within(overdue.closest("section")!).getByText("Late")).toBeVisible();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The view change could not finish.",
  );
  expect(
    screen.getByText(/Could not reschedule the task\./),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
});

it("says Today is clear and points to what comes next", async () => {
  const today = todayString();
  const later = task("later", "Plan the offsite", {
    scheduled: shiftTaskDate(today, 1),
  });
  const someday = task("someday", "Read the field guide");
  const onOpenView = vi.fn();
  const onOpenTask = vi.fn();
  renderToday(repository([someday], { summaries: [someday, later] }), {
    onOpenView,
    onOpenTask,
  });

  expect(await screen.findByText("Today is clear")).toBeVisible();
  const next = await screen.findByRole("button", { name: "Plan the offsite" });
  expect(next.parentElement).toHaveTextContent(
    "Next: Plan the offsite · Tomorrow",
  );
  // Anytime work stays listed beneath the clear line.
  expect(screen.getByText("Read the field guide")).toBeVisible();
  fireEvent.click(next);
  expect(onOpenTask).toHaveBeenCalledWith(later, undefined);
  fireEvent.click(screen.getByRole("button", { name: "See Upcoming" }));
  expect(onOpenView).toHaveBeenCalledWith(upcomingView);
});

it("distinguishes a collection without tasks from a finished day", async () => {
  renderToday(repository([], { summaries: [] }));

  expect(await screen.findByText("No tasks yet")).toBeVisible();
  expect(screen.queryByText("Today is clear")).toBeNull();
});

it("shows a finished day when tasks exist but none remain for today", async () => {
  const today = todayString();
  const done = task("done", "Send the summary", {
    scheduled: today,
    completed: true,
    status: "done",
    completedDate: today,
  });
  renderToday(repository([], { summaries: [done] }));

  expect(await screen.findByText("Today is clear")).toBeVisible();
  expect(
    await screen.findByText("Nothing is scheduled after today."),
  ).toBeVisible();
  expect(screen.getByText(/· 1 of 1 done/)).toBeVisible();
});

it("counts tasks completed today that were planned for today", async () => {
  const today = todayString();
  const open = task("open", "Open today", { scheduled: today });
  const summaries = [
    open,
    task("done", "Done today", {
      due: today,
      completed: true,
      status: "done",
      completedDate: today,
    }),
    // Finished today but planned for yesterday: not part of today's list.
    task("late", "Late finish", {
      scheduled: shiftTaskDate(today, -1),
      completed: true,
      status: "done",
      completedDate: today,
    }),
    // Planned for today but finished earlier.
    task("early", "Early finish", {
      scheduled: today,
      completed: true,
      status: "done",
      completedDate: shiftTaskDate(today, -1),
    }),
  ];
  renderToday(repository([open], { summaries }));

  expect(await screen.findByText(/· 1 of 2 done/)).toBeVisible();
});

const todayView: TaskView = {
  key: "views/today.base#today",
  documentId: "today",
  documentName: "Today",
  id: "today",
  name: "Today",
  properties: [],
  source: {
    path: "views/today.base",
    format: "obsidian.base",
    revision: "one",
    writable: true,
  },
  presentation: {
    type: "tasknotes.task-list",
    mappings: {},
    options: { create: false, sections: "day" },
  },
};

const upcomingView: TaskView = {
  ...todayView,
  key: "views/upcoming.base#upcoming",
  documentId: "upcoming",
  documentName: "Upcoming",
  id: "upcoming",
  name: "Upcoming",
  source: { ...todayView.source, path: "views/upcoming.base" },
  presentation: {
    type: "tasknotes.calendar",
    mappings: {},
    options: { calendarView: "listWeek" },
  },
};

function repository(
  rows: Task[],
  options: {
    summaries?: Task[];
    updateMany?: TaskRepository["updateMany"];
  } = {},
): TaskRepository {
  return taskRepositoryStub(
    {
      listSummaries: async () => options.summaries ?? rows,
      cachedViewExecution: async () => null,
      executeView: async () => ({
        view: todayView,
        rows: rows
          .filter((row) => !row.completed)
          .map((row) => ({ task: row, values: {} })),
        totalCount: rows.length,
        hasMore: false,
        groups: [],
      }),
      readViewSource: async () => ({
        path: todayView.source.path,
        format: "obsidian.base",
        revision: "one",
        document: `views:
  - type: tasknotesTaskList
    name: Today
    options: { sections: day }
`,
      }),
      updateMany: options.updateMany,
      collectionInfo: async () => ({
        kind: "connect" as const,
        id: "today-tests",
        name: "Today tests",
        location: "memory://today-tests",
        runtime: "browser" as const,
      }),
    },
    rows.length,
  );
}

function renderToday(
  repository: TaskRepository,
  handlers: {
    onOpenView?: (view: TaskView) => void;
    onOpenTask?: (task: Task, occurrence?: string) => void;
  } = {},
) {
  return render(
    <RepositoryProvider
      mutationJournal={new MemoryMutationJournal()}
      repository={repository}
    >
      <ViewsScreen
        documents={[todayView, upcomingView].map((view) => ({
          id: view.documentId,
          name: view.documentName,
          source: view.source,
          views: [view],
        }))}
        navigationViewKeys={[todayView.key, upcomingView.key]}
        operational
        viewKey={todayView.key}
        views={[todayView, upcomingView]}
        onBack={() => undefined}
        onOpenTask={handlers.onOpenTask ?? (() => undefined)}
        onOpenView={handlers.onOpenView ?? (() => undefined)}
        onSearch={() => undefined}
        onMoveNavigationView={() => undefined}
        onToggleNavigationView={() => undefined}
        onViewsChanged={async () => undefined}
      />
    </RepositoryProvider>,
  );
}

function apply(tasks: Task[], id: string, input: UpdateTaskInput): Task {
  const target = tasks.find((candidate) => candidate.id === id)!;
  if (input.scheduled !== undefined)
    target.scheduled = input.scheduled ?? undefined;
  return target;
}

function task(id: string, title: string, patch: Partial<Task> = {}): Task {
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
    attachments: [],
    blockedBy: [],
    completeInstances: [],
    skippedInstances: [],
    reminders: [],
    timeEntries: [],
    customProperties: {},
    revision: 1,
    frontmatter: { status: "open" },
    ...patch,
  };
}
