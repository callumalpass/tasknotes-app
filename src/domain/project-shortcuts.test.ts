import { describe, expect, it } from "vitest";
import { projectShortcuts } from "./project-shortcuts";

const task = (projects: string[], completed = false) => ({
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

  it("keeps the busiest when the list is short", () => {
    const tasks = ["z", "z", "a", "b"].map((name) => task([name]));
    expect(projectShortcuts(tasks, 2).map(({ label }) => label)).toEqual([
      "a",
      "z",
    ]);
  });
});
