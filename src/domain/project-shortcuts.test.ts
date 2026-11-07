import { describe, expect, it } from "vitest";
import { projectShortcuts } from "./project-shortcuts";

const task = (
  projects: string[],
  completed = false,
  path = "Tasks/task.md",
) => ({
  path,
  projects,
  completed,
  archived: false,
});

describe("projectShortcuts", () => {
  it("counts open tasks by readable project name, in name order", () => {
    expect(
      projectShortcuts([
        task(["[[Projects/Field research]]"]),
        task(["Operations"]),
        task(["Operations"]),
        task(["Operations"], true),
      ]),
    ).toEqual([
      { label: "Field research", count: 1 },
      { label: "Operations", count: 2 },
    ]);
  });

  it("leaves out a parent task, whose links are subtasks", () => {
    expect(
      projectShortcuts([
        task(["Operations"], false, "Tasks/child.md"),
        task(["[[Tasks/Plan the offsite]]"], false, "Tasks/grandchild.md"),
        task(["[[Plan the offsite]]"], false, "Tasks/sibling.md"),
        task([], false, "Tasks/Plan the offsite.md"),
      ]),
    ).toEqual([{ label: "Operations", count: 1 }]);
  });

  it("keeps the busiest when the list is short", () => {
    const tasks = ["z", "z", "a", "b"].map((name) => task([name]));
    expect(projectShortcuts(tasks, 2).map(({ label }) => label)).toEqual([
      "a",
      "z",
    ]);
  });
});
