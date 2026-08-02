import { describe, expect, it } from "vitest";

import {
  appendManualOrderRank,
  disableManualOrderSort,
  enableManualOrderSort,
  isTaskNotesSortRank,
  manualOrderConfiguration,
  planManualOrder,
  sortTasksByManualOrder,
} from "./manual-order";

import type { Task } from "./task";

describe("TaskNotes manual order", () => {
  it("recognizes the configured TaskNotes field only as the primary sort", () => {
    expect(
      manualOrderConfiguration(
        [
          {
            property: 'note["tasknotes_manual_order"]',
            direction: "desc",
          },
        ],
        "tasknotes_manual_order",
      ),
    ).toEqual({
      property: 'note["tasknotes_manual_order"]',
      direction: "desc",
    });
    expect(
      manualOrderConfiguration(
        [
          { property: "title", direction: "asc" },
          { property: "note.tasknotes_manual_order", direction: "desc" },
        ],
        "tasknotes_manual_order",
      ),
    ).toBeNull();
  });

  it("prepends manual order without losing the existing sort conditions", () => {
    const sort = [
      { property: "due", direction: "asc" as const },
      {
        property: 'note["tasknotes_manual_order"]',
        direction: "asc" as const,
      },
      { property: "priority", direction: "desc" as const },
    ];

    expect(
      enableManualOrderSort(
        sort,
        "tasknotes_manual_order",
        "note.tasknotes_manual_order",
      ),
    ).toEqual([
      {
        property: 'note["tasknotes_manual_order"]',
        direction: "asc",
      },
      { property: "due", direction: "asc" },
      { property: "priority", direction: "desc" },
    ]);
  });

  it("removes only manual order so the preserved sorts take over", () => {
    expect(
      disableManualOrderSort(
        [
          {
            property: "note.tasknotes_manual_order",
            direction: "desc",
          },
          { property: "due", direction: "asc" },
          { property: "priority", direction: "desc" },
        ],
        "tasknotes_manual_order",
      ),
    ).toEqual([
      { property: "due", direction: "asc" },
      { property: "priority", direction: "desc" },
    ]);
  });

  it("rebalances missing and legacy ranks into plugin-compatible alpha ranks", () => {
    const alpha = task("alpha");
    const bravo = task("bravo", "0|hzzzzz:");
    const charlie = task("charlie");
    const plan = planManualOrder(
      [alpha, bravo, charlie],
      charlie,
      "alpha",
      "before",
      "desc",
    );

    expect(plan.reason).toBe("rebalance");
    expect(plan.order).toEqual(["charlie", "alpha", "bravo"]);
    expect(plan.writes).toHaveLength(3);
    expect(
      plan.writes.every(({ sortOrder }) => isTaskNotesSortRank(sortOrder)),
    ).toBe(true);
    expect(
      sortTasksByManualOrder(
        plan.order.map((id) => ({
          ...task(id),
          sortOrder: plan.writes.find((write) => write.taskId === id)!
            .sortOrder,
        })),
        "desc",
      ).map(({ id }) => id),
    ).toEqual(plan.order);
  });

  it("uses a single midpoint write once ranks are sparse", () => {
    const alpha = task("alpha", "tnzzzzzzzzzz");
    const bravo = task("bravo", "tnnnnnnnnnnn");
    const charlie = task("charlie", "tnaaaaaaaaaa");
    const plan = planManualOrder(
      [alpha, bravo, charlie],
      charlie,
      "alpha",
      "after",
      "desc",
    );

    expect(plan.reason).toBe("midpoint");
    expect(plan.order).toEqual(["alpha", "charlie", "bravo"]);
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0].taskId).toBe("charlie");
    expect(
      sortTasksByManualOrder(
        [alpha, bravo, { ...charlie, sortOrder: plan.writes[0].sortOrder }],
        "desc",
      ).map(({ id }) => id),
    ).toEqual(plan.order);
  });

  it("creates an append rank only when the existing order is safe", () => {
    expect(appendManualOrderRank([], "desc")).toMatch(/^tn[a-z]{10}$/);
    expect(
      appendManualOrderRank(
        [task("alpha", "tnzzzzzzzzzz"), task("bravo", "tnnnnnnnnnnn")],
        "desc",
      ),
    ).toMatch(/^tn[a-z]{10}$/);
    expect(
      appendManualOrderRank([task("legacy", "0|hzzzzz:")], "desc"),
    ).toBeUndefined();
  });
});

function task(id: string, sortOrder?: string): Task {
  return {
    id,
    path: `tasks/${id}.md`,
    title: id,
    status: "open",
    completed: false,
    archived: false,
    priority: "normal",
    body: "",
    createdAt: "",
    updatedAt: "",
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
    frontmatter: {},
    sortOrder,
  };
}
