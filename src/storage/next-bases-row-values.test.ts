import { describe, expect, it } from "vitest";
import type { AppBasesCell } from "@mdbase-dev/sdk/app-host";
import { nativeRowValues } from "./next-bases-row-values";
const text = (value: string): AppBasesCell => ({ kind: "text", value });
const rows = [{ cells: [text("First")] }, { cells: [text("Second")] }];
// Explicit decoded-native stand-ins, not native partition/authority evidence.
describe("native row group-value projection", () => {
  it("uses native membership when the group property is not a display column", () => {
    const values = nativeRowValues(
      ["note.title"],
      rows,
      [
        { key: text("closed"), rowIndices: [1] },
        { key: text("open"), rowIndices: [0] },
      ],
      "note.status",
    );
    expect(values).toEqual([
      { "note.title": "First", "note.status": "open" },
      { "note.title": "Second", "note.status": "closed" },
    ]);
  });
  it.each<AppBasesCell>([
    { kind: "null" },
    { kind: "boolean", value: false },
    text(""),
  ])("retains explicit native scalar $kind without defaults", (key) => {
    const values = nativeRowValues(
      [],
      [{ cells: [] }],
      [{ key, rowIndices: [0] }],
      "status",
    );
    expect(Object.hasOwn(values[0]!, "status")).toBe(true);
    expect(values[0]!.status).toEqual(
      key.kind === "null" ? null : "value" in key ? key.value : undefined,
    );
  });
  it("does not overwrite a display cell's authoritative temporal provenance", () => {
    const cell = {
      kind: "date" as const,
      millis: 1,
      authoritativeZone: "US/Eastern",
      dateOnly: false,
      display: "row display",
    };
    const key = {
      ...cell,
      authoritativeZone: "America/New_York",
      display: "group display",
    };
    expect(
      nativeRowValues(
        ["due"],
        [{ cells: [cell] }],
        [{ key, rowIndices: [0] }],
        "due",
      ),
    ).toEqual([{ due: cell }]);
  });
  it.each(
    [[0, 0], [-1], [2], [0.5], [NaN]].map((rowIndices) => ({ rowIndices })),
  )(
    "refuses invalid or repeated native indices $rowIndices",
    ({ rowIndices }) => {
      expect(() =>
        nativeRowValues(
          ["title"],
          rows,
          [{ key: text("group"), rowIndices }],
          "status",
        ),
      ).toThrow("partition");
    },
  );
  it("refuses incomplete membership rather than deriving groups from row contents", () => {
    expect(() =>
      nativeRowValues(
        ["title"],
        rows,
        [{ key: text("group"), rowIndices: [0] }],
        "status",
      ),
    ).toThrow("incomplete");
    expect(() => nativeRowValues(["title"], rows, [], "status")).toThrow(
      "omitted its row partition",
    );
  });
  it("allows an empty grouped execution and an ordinary ungrouped execution", () => {
    expect(nativeRowValues([], [], [], "status")).toEqual([]);
    expect(nativeRowValues(["title"], rows, [])).toEqual([
      { title: "First" },
      { title: "Second" },
    ]);
  });
  it("uses a safe own data key rather than a prototype setter", () => {
    const values = nativeRowValues(
      [],
      [{ cells: [] }],
      [{ key: text("key"), rowIndices: [0] }],
      "__proto__",
    );
    expect(Object.hasOwn(values[0]!, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(values[0]!)).toBe(Object.prototype);
    expect(values[0]!.__proto__).toBe("key");
  });
  it("refuses malformed cell arity or a missing group property", () => {
    expect(() => nativeRowValues([], rows, [])).toThrow("declared columns");
    expect(() =>
      nativeRowValues(["title"], rows, [
        { key: text("group"), rowIndices: [0, 1] },
      ]),
    ).toThrow("group property");
  });
});
