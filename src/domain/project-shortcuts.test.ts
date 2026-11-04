import { describe, expect, it } from "vitest";
import { projectShortcuts } from "./project-shortcuts";

const task = (projects: string[], completed = false) => ({
  projects,
  completed,
  archived: false,
});

describe("projectShortcuts", () => {
  it("counts open tasks by readable project name, busiest first", () => {
    expect(
      projectShortcuts([
        task(["[[Projects/Field research]]"]),
        task(["Operations"]),
        task(["Operations"]),
        task(["Operations"], true),
      ]),
    ).toEqual([
      { label: "Operations", count: 2 },
      { label: "Field research", count: 1 },
    ]);
  });

  it("keeps the list short", () => {
    const tasks = ["a", "b", "c"].map((name) => task([name]));
    expect(projectShortcuts(tasks, 2)).toHaveLength(2);
  });
});
