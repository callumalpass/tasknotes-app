import { expect, it } from "vitest";
import { TaskNotesTaskModel } from "./tasknotes-model";
import { groupTaskViewRows } from "./view-grouping";

it("preserves group precedence, row order and unmatched rows with repeated identities", () => {
  const model = new TaskNotesTaskModel();
  const task = (id: string) => model.create({ title: id }, { id });
  const repeated = task("repeated");
  const unmatched = task("unmatched");
  const rows = [
    { task: repeated, values: { project: "beta" } },
    { task: task("first"), values: { project: "alpha", status: "open" } },
    { task: repeated, values: { project: "alpha", status: "open" } },
    { task: unmatched, values: {} },
    { task: unmatched, values: { project: null } },
    { task: task("second"), values: { project: "beta" } },
  ];
  const groups = [
    { values: {}, count: 0, summaries: {} },
    { values: { status: "open", project: "alpha" }, count: 7, summaries: {} },
    { values: { project: "beta" }, count: 2, summaries: {} },
    { values: { project: "alpha", status: "open" }, count: 7, summaries: {} },
  ];

  expect(groupTaskViewRows({ rows, groups })).toEqual([
    {
      key: '1:{"status":"open","project":"alpha"}',
      values: groups[1].values,
      count: 7,
      rows: [rows[1], rows[2]],
    },
    {
      key: '2:{"project":"beta"}',
      values: groups[2].values,
      count: 2,
      rows: [rows[5]],
    },
    {
      key: '3:{"project":"alpha","status":"open"}',
      values: groups[3].values,
      count: 7,
      rows: [],
    },
    { key: "ungrouped", values: {}, count: 2, rows: [rows[3], rows[4]] },
  ]);
});
