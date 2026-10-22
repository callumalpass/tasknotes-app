import { describe, expect, it } from "vitest";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { viewPropertyMoveInput } from "../domain/view-mutation";
import { kanbanRowValue } from "./views/kanban-columns";
import {
  executionWithDepartures,
  removeConfirmedBoardMoves,
  settledRowCount,
  type CompletionDeparture,
  type OptimisticBoardMove,
} from "./optimistic-view-reconciliation";
import type { TaskViewExecution, TaskViewRow } from "../domain/view";

// Provider-neutral projected-row fixtures; not a native READ reproduction.
const task = new TaskNotesTaskModel().create(
  { title: "Projected row", contexts: ["home", "office"] },
  { id: "00000000-0000-4000-8000-000000000001" },
);
const row = {
  task: {
    ...task,
    frontmatter: {
      ...task.frontmatter,
      status: "open",
      contexts: ["home", "office"],
    },
  },
  values: {} as Record<string, unknown>,
};
const moves = (property: string, value: unknown) =>
  new Map<string, OptimisticBoardMove>([
    [task.id, { viewKey: "board", property, value, sequence: 1 }],
  ]);
describe("authoritative board move reconciliation", () => {
  it.each(["status", "note.status"])(
    "does not confirm a move from raw fallback when %s is authoritatively null",
    (property) => {
      const pending = moves(property, "open");
      expect(
        removeConfirmedBoardMoves(
          pending,
          new Map([[task.id, { ...row, values: { [property]: null } }]]),
          "board",
        ),
      ).toBe(pending);
    },
  );
  it.each(["status", "note.status"])(
    "confirms null %s without replacing it from frontmatter",
    (property) => {
      const pending = moves(property, null);
      const result = removeConfirmedBoardMoves(
        pending,
        new Map([[task.id, { ...row, values: { [property]: null } }]]),
        "board",
      );
      expect(result.size).toBe(0);
      expect(pending.size).toBe(1);
    },
  );
  it.each(["status", "note.status"])(
    "retains legacy fallback when %s is absent",
    (property) => {
      expect(
        removeConfirmedBoardMoves(
          moves(property, "open"),
          new Map([[task.id, row]]),
          "board",
        ).size,
      ).toBe(0);
      const pending = moves(property, null);
      expect(
        removeConfirmedBoardMoves(pending, new Map([[task.id, row]]), "board"),
      ).toBe(pending);
    },
  );
  it("leaves another view's overlay alone", () => {
    const pending = moves("status", null);
    expect(
      removeConfirmedBoardMoves(
        pending,
        new Map([[task.id, { ...row, values: { status: null } }]]),
        "other-view",
      ),
    ).toBe(pending);
  });
  it("retains an optimistic destination until the projected view confirms that destination", () => {
    const pending = moves("status", "open");
    expect(
      removeConfirmedBoardMoves(
        pending,
        new Map([[task.id, { ...row, values: { status: null } }]]),
        "board",
      ),
    ).toBe(pending);
    expect(
      removeConfirmedBoardMoves(
        pending,
        new Map([[task.id, { ...row, values: { status: "open" } }]]),
        "board",
      ).size,
    ).toBe(0);
  });
  it("moves only the projected list occurrence while preserving the other stored values", () => {
    const projected = { ...row, values: { "note.contexts": "home" } };
    expect(
      viewPropertyMoveInput({
        task: projected.task,
        property: "note.contexts",
        sourceValue: kanbanRowValue(projected, "note.contexts"),
        destinationValue: "shop",
        preserveOtherListValues: true,
      }),
    ).toEqual({ contexts: ["office", "shop"] });
  });
  it("authoritative null removes no list occurrence, while absence uses the stored list", () => {
    const input = (values: Record<string, unknown>) =>
      viewPropertyMoveInput({
        task: row.task,
        property: "note.contexts",
        sourceValue: kanbanRowValue({ ...row, values }, "note.contexts"),
        destinationValue: "shop",
        preserveOtherListValues: true,
      });
    expect(input({ "note.contexts": null })).toEqual({
      contexts: ["home", "office", "shop"],
    });
    expect(input({})).toEqual({ contexts: ["shop"] });
  });
});

describe("completion departures", () => {
  const listRow = (id: string): TaskViewRow => ({
    task: { ...task, id, title: id },
    values: {},
  });
  const execution = (
    rows: TaskViewRow[],
    groups: TaskViewExecution["groups"] = [],
  ) =>
    ({
      view: { key: "today" },
      rows,
      totalCount: rows.length,
      hasMore: false,
      groups,
    }) as unknown as TaskViewExecution;
  const departure = (
    id: string,
    index: number,
    extra: Partial<CompletionDeparture> = {},
  ): [string, CompletionDeparture] => [
    id,
    {
      viewKey: "today",
      row: listRow(id),
      index,
      groups: [],
      acceptedAt: 10,
      ...extra,
    },
  ];

  it("holds dropped rows in place, completed, in index order", () => {
    const result = executionWithDepartures(
      execution([listRow("a"), listRow("d")]),
      new Map([departure("c", 2), departure("b", 1)]),
      "today",
    );
    expect(result.execution.rows.map((row) => row.task.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(result.execution.rows[1]!.task.completed).toBe(true);
    expect(result.execution.totalCount).toBe(2);
    expect([...result.departing]).toEqual([
      ["b", 10],
      ["c", 10],
    ]);
    expect(settledRowCount(result.execution.rows, result.departing)).toBe(2);
  });

  it("never duplicates a row the result still shows, or holds another view's", () => {
    const shown = execution([listRow("a"), listRow("b")]);
    const result = executionWithDepartures(
      shown,
      new Map([departure("b", 0), departure("z", 0, { viewKey: "other" })]),
      "today",
    );
    expect(result.execution).toBe(shown);
    expect(result.departing.size).toBe(0);
  });

  it("keeps an emptied group so the held row folds where it was", () => {
    const work = { values: { project: "work" }, count: 1, summaries: {} };
    const home = { values: { project: "home" }, count: 1, summaries: {} };
    const result = executionWithDepartures(
      execution([listRow("a")], [home]),
      new Map([departure("b", 0, { groups: [work, home] })]),
      "today",
    );
    expect(result.execution.groups).toEqual([work, home]);
  });
});
