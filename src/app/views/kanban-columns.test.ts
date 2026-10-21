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
describe("Kanban authoritative values and column order", () => {
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
  it("keeps configured columns in configured order whatever the group order", () => {
    const columns = [
      { value: "none" },
      { value: "open" },
      { value: "in-progress" },
      { value: "closed" },
    ];
    for (const groups of [
      [{ values: { status: "closed" } }, { values: { status: "open" } }],
      [{ values: { status: "open" } }],
      [],
    ])
      expect(orderedKanbanColumns(columns, groups, "status", 4)).toEqual(
        columns,
      );
  });
  it("places unconfigured values after configured ones in supplied group order", () => {
    const columns = [
      { value: "open", rows: ["open-first", "open-second"] },
      { value: "closed", rows: [] },
      { value: "legacy", rows: ["legacy-first"] },
      { value: "blocked", rows: ["blocked-first"] },
      { value: "row-only", rows: ["row-only-first"] },
    ];
    const groups = [
      { values: { status: "blocked" } },
      { values: { status: "closed" } },
      { values: { status: "legacy" } },
    ];
    const ordered = orderedKanbanColumns(columns, groups, "status", 2);
    expect(ordered.map(({ value }) => value)).toEqual([
      "open",
      "closed",
      "blocked",
      "legacy",
      "row-only",
    ]);
    expect(ordered[0]).toBe(columns[0]);
    expect(ordered[0]!.rows).toBe(columns[0]!.rows);
    expect(columns.map(({ value }) => value)).toEqual([
      "open",
      "closed",
      "legacy",
      "blocked",
      "row-only",
    ]);
  });
  it("uses supplied group order when nothing is configured", () => {
    const columns = [{ value: "a" }, { value: "b" }, { value: "c" }];
    expect(
      orderedKanbanColumns(
        columns,
        [{ values: { area: "c" } }, { values: { area: "a" } }],
        "area",
      ),
    ).toEqual([columns[2], columns[0], columns[1]]);
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
    expect(orderedKanbanColumns(columns, groups, "status")).toEqual([
      columns[1],
      columns[0],
    ]);
    expect(orderedKanbanColumns(columns, groups, "status", 2)).toEqual(columns);
  });
});
