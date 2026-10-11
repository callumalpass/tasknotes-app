import { describe, expect, it } from "vitest";
import { dropPositionAt, previewDrop, type DropLayout } from "./drop-geometry";

// Two stacked sections: rows a, b, c (40px each) and an empty "later" lane.
const layout: DropLayout = {
  lanes: [
    {
      key: "today",
      left: 0,
      right: 400,
      top: 0,
      bottom: 160,
      rows: [
        { id: "a", top: 40, bottom: 80 },
        { id: "b", top: 80, bottom: 120 },
        { id: "c", top: 120, bottom: 160 },
      ],
    },
    { key: "later", left: 0, right: 400, top: 200, bottom: 280, rows: [] },
  ],
};

describe("dropPositionAt", () => {
  it("picks the slot whose midpoint the pointer has passed", () => {
    expect(dropPositionAt(layout, { x: 10, y: 105 }, "a")).toEqual({
      laneKey: "today",
      targetId: "c",
      placement: "before",
    });
    expect(dropPositionAt(layout, { x: 10, y: 150 }, "a")).toEqual({
      laneKey: "today",
      targetId: "c",
      placement: "after",
    });
    expect(dropPositionAt(layout, { x: 10, y: 50 }, "c")).toEqual({
      laneKey: "today",
      targetId: "a",
      placement: "before",
    });
  });

  it("is no move over the dragged row's own slot", () => {
    expect(dropPositionAt(layout, { x: 10, y: 95 }, "a")).toBeNull();
    expect(dropPositionAt(layout, { x: 10, y: 45 }, "a")).toBeNull();
  });

  it("depends only on the snapshot, so repeated reads agree", () => {
    const first = dropPositionAt(layout, { x: 10, y: 130 }, "a");
    for (let index = 0; index < 5; index += 1)
      expect(dropPositionAt(layout, { x: 10, y: 130 }, "a")).toEqual(first);
  });

  it("drops into an empty lane and reaches across the gap to it", () => {
    expect(dropPositionAt(layout, { x: 10, y: 240 }, "a")).toEqual({
      laneKey: "later",
      placement: "after",
    });
    expect(dropPositionAt(layout, { x: 10, y: 190 }, "a")).toBeNull();
    expect(
      dropPositionAt(layout, { x: 10, y: 190 }, "a", { reach: 24 }),
    ).toEqual({ laneKey: "later", placement: "after" });
  });

  it("ignores pointers beyond the lanes' sides unless within slack", () => {
    expect(dropPositionAt(layout, { x: -30, y: 105 }, "a")).toBeNull();
    expect(
      dropPositionAt(layout, { x: -30, y: 105 }, "a", { slack: 48 }),
    ).toMatchObject({ laneKey: "today", targetId: "c" });
  });

  it("prefers the nearest lane when several are within reach", () => {
    const columns: DropLayout = {
      lanes: [
        { key: "one", left: 0, right: 100, top: 0, bottom: 100, rows: [] },
        { key: "two", left: 120, right: 220, top: 0, bottom: 100, rows: [] },
      ],
    };
    expect(
      dropPositionAt(columns, { x: 115, y: 50 }, "x", { slack: 16 }),
    ).toEqual({ laneKey: "two", placement: "after" });
    expect(
      dropPositionAt(columns, { x: 104, y: 50 }, "x", { slack: 16 }),
    ).toEqual({ laneKey: "one", placement: "after" });
  });
});

describe("previewDrop", () => {
  const lanes = [
    { key: "today", rows: ["a", "b", "c"] },
    { key: "later", rows: [] as string[] },
  ];
  const id = (row: string) => row;

  it("moves the dragged row into the named slot", () => {
    expect(
      previewDrop(lanes, id, "a", {
        laneKey: "today",
        targetId: "c",
        placement: "before",
      }).map((lane) => lane.rows),
    ).toEqual([["b", "a", "c"], []]);
  });

  it("moves across lanes, appending without a target", () => {
    expect(
      previewDrop(lanes, id, "b", {
        laneKey: "later",
        placement: "after",
      }).map((lane) => lane.rows),
    ).toEqual([["a", "c"], ["b"]]);
  });

  it("leaves lanes alone without a drop", () => {
    expect(previewDrop(lanes, id, "a", null)).toEqual(lanes);
  });
});
