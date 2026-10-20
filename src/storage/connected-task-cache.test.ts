import { connectedTaskStats } from "./connected-task-cache";

import type { Task } from "../domain/task";

it("counts archived tasks separately from total/open/completed", () => {
  const open = fixtureTask("open", "Open");
  const done = fixtureTask("done", "Done", {
    completed: true,
    status: "done",
  });
  const archived = fixtureTask("old", "Old", { archived: true });

  expect(
    connectedTaskStats([{ task: open }, { task: done }, { task: archived }]),
  ).toEqual({ total: 2, open: 1, completed: 1, archived: 1 });
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
    attachments: overrides.attachments ?? [],
  };
}
