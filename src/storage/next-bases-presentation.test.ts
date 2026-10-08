import { describe, expect, it } from "vitest";
import type { AppBasesDescriptor } from "@mdbase-dev/sdk/app-host";
import { nativePresentation } from "./next-bases-presentation";
const descriptor: AppBasesDescriptor = {
  record: "00000000-0000-0000-0000-000000000001",
  sourceRevision: "sha256:" + "ab".repeat(32),
  path: "tasks.base",
  ordinal: 1,
  name: "Same",
  viewType: "tasknotesKanban",
  implementations: [],
};
describe("selected native source presentation (synthetic source only)", () => {
  it("uses the original ordinal, not repeated name or supported-view subset", () => {
    const source =
      "properties:\n  note.status:\n    displayName: State\n    hidden: false\nviews:\n  - name: Same\n    type: table\n  - name: Same\n    type: tasknotesKanban\n    groupBy:\n      property: note.status\n    options:\n      compact: true\n";
    const result = nativePresentation(source, descriptor, ["note.status"]);
    expect(result.properties).toEqual([
      { key: "note.status", label: "State", hidden: false },
    ]);
    expect(result.groupProperty).toBe("note.status");
    expect(result.presentation.mappings.column).toBe("note.status");
    expect(result.presentation.options).toEqual({ compact: true });
  });
  it("refuses mismatched or absent original declaration rather than selecting by name", () => {
    expect(() =>
      nativePresentation("views:\n  - name: Same\n", descriptor, []),
    ).toThrow();
    expect(() =>
      nativePresentation(
        "views:\n  - name: Same\n  - name: Other\n",
        descriptor,
        [],
      ),
    ).toThrow("original ordinal");
  });
  it("supports native-validated markdown frontmatter without evaluating filters", () => {
    const source =
      "---\nviews:\n  - name: Same\n    filters: invalid-but-never-js-evaluated\n---\nBody";
    expect(
      nativePresentation(
        source,
        { ...descriptor, ordinal: 0, viewType: "table" },
        [],
      ).presentation.type,
    ).toBe("table");
  });
});
