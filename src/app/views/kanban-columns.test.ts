import { describe, expect, it } from "vitest";
import { TaskNotesTaskModel } from "../../domain/tasknotes-model";
import { kanbanRowValue, orderedKanbanColumns } from "./kanban-columns";

// Pure provider-neutral helper fixtures; no DOM/native/authority proof.
const task = new TaskNotesTaskModel().create(
  { title: "Metadata fixture" },
  { id: "00000000-0000-4000-8000-000000000001" },
);
const row = {
  task: {
    ...task,
    frontmatter: { ...task.frontmatter, status: "legacy-open" },
  },
  values: {} as Record<string, unknown>,
};
describe("Kanban authoritative values and group order", () => {
  it.each([null, false, "", 0])(
    "preserves present authoritative value %j without frontmatter fallback",
    (value) => {
      expect(
        kanbanRowValue({ ...row, values: { status: value } }, "status"),
      ).toBe(value);
    },
  );
  it("uses mapped note fields only when the output value is absent", () => {
    expect(kanbanRowValue(row, "status")).toBe("legacy-open");
    expect(kanbanRowValue(row, "note.status")).toBe("legacy-open");
    expect(
      kanbanRowValue(
        { ...row, values: { "note.status": null } },
        "note.status",
      ),
    ).toBeNull();
    expect(kanbanRowValue(row, "absent")).toBeNull();
  });
  it("preserves explicit error/unavailable values rather than substituting defaults", () => {
    const value = {
      kind: "unavailable",
      code: "metadata",
      detail: "unavailable",
    };
    expect(
      kanbanRowValue({ ...row, values: { status: value } }, "status"),
    ).toBe(value);
  });
  it("uses supplied group order ahead of configured columns without reordering row arrays", () => {
    const columns = [
      { value: "open", label: "Open", rows: ["open-first", "open-second"] },
      { value: "closed", label: "Closed", rows: ["closed-first"] },
      { value: "unused", label: "Configured empty", rows: [] },
    ];
    const groups = [
      { values: { status: "closed" } },
      { values: { status: "open" } },
    ];
    const ordered = orderedKanbanColumns(columns, groups, "status");
    expect(ordered.map(({ value }) => value)).toEqual([
      "closed",
      "open",
      "unused",
    ]);
    expect(ordered[0]).toBe(columns[1]);
    expect(ordered[1]).toBe(columns[0]);
    expect(ordered[1]!.rows).toBe(columns[0]!.rows);
    expect(columns.map(({ value }) => value)).toEqual([
      "open",
      "closed",
      "unused",
    ]);
  });
  it("keeps original order when metadata groups refer to a different column property", () => {
    const columns = [{ value: "open" }, { value: "closed" }];
    expect(
      orderedKanbanColumns(
        columns,
        [{ values: { priority: "high" } }],
        "status",
      ),
    ).toEqual(columns);
    expect(orderedKanbanColumns(columns, [], "status")).toEqual(columns);
  });
  it("keeps null as a group key and does not duplicate columns for repeated group metadata", () => {
    const columns = [{ value: "open" }, { value: null }];
    const groups = [{ values: { status: null } }, { values: { status: null } }];
    expect(orderedKanbanColumns(columns, groups, "status")).toEqual(columns);
  });
  it("preserves configured empty-column slots while supplying actual group order", () => {
    const columns = [
      { value: "none" },
      { value: "open" },
      { value: "in-progress" },
      { value: "closed" },
    ];
    expect(
      orderedKanbanColumns(columns, [{ values: { status: "open" } }], "status"),
    ).toEqual(columns);
    const ordered = orderedKanbanColumns(
      columns,
      [{ values: { status: "closed" } }, { values: { status: "open" } }],
      "status",
    );
    expect(ordered).toEqual([columns[0], columns[3], columns[2], columns[1]]);
    expect(
      ordered
        .filter(({ value }) => value === "open" || value === "closed")
        .map(({ value }) => value),
    ).toEqual(["closed", "open"]);
  });
});
