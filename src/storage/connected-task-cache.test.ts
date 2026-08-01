import {
  connectedTaskSignature,
  connectedTaskStats,
  connectedViewExecutionKey,
  listConnectedTasks,
} from "./connected-task-cache";

import type { Task } from "../domain/task";
import type { TaskView } from "../domain/view";

it("applies shared search, state, archive, and limit projection rules", () => {
  const cached = [
    { task: fixtureTask("open", "Open release", { tags: ["laptop"] }) },
    {
      task: fixtureTask("done", "Completed release", {
        completed: true,
        status: "done",
      }),
    },
    { task: fixtureTask("old", "Archived release", { archived: true }) },
  ];

  expect(
    listConnectedTasks(cached, { search: "release laptop" }).map(
      ({ id }) => id,
    ),
  ).toEqual(["open"]);
  expect(
    listConnectedTasks(cached, { status: "completed" }).map(({ id }) => id),
  ).toEqual(["done"]);
  expect(
    listConnectedTasks(cached, { archived: "only", limit: 1 }).map(
      ({ id }) => id,
    ),
  ).toEqual(["old"]);
});

it("shares connected statistics and stable projection keys", () => {
  const open = fixtureTask("open", "Open");
  const done = fixtureTask("done", "Done", {
    completed: true,
    status: "done",
  });
  const archived = fixtureTask("old", "Old", { archived: true });

  expect(
    connectedTaskStats([{ task: open }, { task: done }, { task: archived }]),
  ).toEqual({ total: 2, open: 1, completed: 1, archived: 1 });
  expect(connectedTaskSignature(open)).toBe(
    JSON.stringify([open.path, open.frontmatter, open.body]),
  );
  expect(
    connectedViewExecutionKey({
      key: "views/work.base#All",
      source: { revision: "revision-2" },
    } as TaskView),
  ).toBe("views/work.base#All:revision-2");
});

function fixtureTask(
  id: string,
  title: string,
  overrides: Partial<Task> = {},
): Task {
  return {
    id,
    path: `tasks/${id}.md`,
    title,
    status: "open",
    completed: false,
    archived: false,
    priority: "normal",
    body: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
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
    frontmatter: { id, title },
    ...overrides,
  };
}
