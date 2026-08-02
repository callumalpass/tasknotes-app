import { describe, expect, it } from "vitest";

import { taskRelationships } from "./task-relationships";

import type { Task } from "./task";

describe("task relationships", () => {
  it("resolves blockers and derives blocking tasks and subtasks", () => {
    const parent = task("parent", "projects/Parent.md", {
      blockedBy: [
        {
          uid: "[[tasks/Blocker]]",
          reltype: "FINISHTOSTART",
          gap: "P1D",
        },
      ],
    });
    const blocker = task("blocker", "tasks/Blocker.md");
    const dependent = task("dependent", "tasks/Dependent.md", {
      blockedBy: [{ uid: "[[projects/Parent]]", reltype: "STARTTOSTART" }],
    });
    const child = task("child", "tasks/Child.md", {
      projects: ["[Parent](/projects/Parent.md)"],
    });

    const relationships = taskRelationships(parent, [
      parent,
      blocker,
      dependent,
      child,
    ]);

    expect(relationships.blockedBy).toEqual([
      {
        dependency: parent.blockedBy[0],
        task: blocker,
      },
    ]);
    expect(relationships.blocking).toEqual([dependent]);
    expect(relationships.subtasks).toEqual([child]);
  });

  it("resolves raw task ids and project tasks without persisting inverses", () => {
    const project = task("project-id", "tasks/Project.md");
    const child = task("child", "tasks/Child.md", {
      blockedBy: [{ uid: "project-id", reltype: "FINISHTOFINISH" }],
      projects: ["[[tasks/Project]]"],
    });

    const relationships = taskRelationships(child, [project, child]);

    expect(relationships.blockedBy[0].task).toBe(project);
    expect(relationships.projectTasks).toEqual([project]);
    expect(project.frontmatter).not.toHaveProperty("blocking");
    expect(project.frontmatter).not.toHaveProperty("subtasks");
  });

  it("profiles a large relationship graph without quadratic inverse scans", () => {
    const parent = task("parent", "tasks/Parent.md");
    const tasks = Array.from({ length: 20_000 }, (_, index) =>
      task(`task-${index}`, `tasks/Task ${index}.md`, {
        blockedBy:
          index % 10 === 0
            ? [
                {
                  uid: "[[tasks/Parent]]",
                  reltype: "FINISHTOSTART",
                },
              ]
            : [],
        projects: index % 20 === 0 ? ["[[tasks/Parent]]"] : [],
      }),
    );

    const startedAt = performance.now();
    const relationships = taskRelationships(parent, [parent, ...tasks]);
    const elapsedMs = performance.now() - startedAt;

    expect(relationships.blocking).toHaveLength(2_000);
    expect(relationships.subtasks).toHaveLength(1_000);
    expect(elapsedMs).toBeLessThan(750);
  });
});

function task(id: string, path: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    path,
    title: id,
    status: "open",
    completed: false,
    archived: false,
    priority: "normal",
    body: "",
    createdAt: "",
    updatedAt: "",
    tags: ["task"],
    contexts: [],
    projects: [],
    blockedBy: [],
    completeInstances: [],
    skippedInstances: [],
    reminders: [],
    timeEntries: [],
    customProperties: {},
    revision: 1,
    frontmatter: {},
    ...patch,
    attachments: patch.attachments ?? [],
  };
}
