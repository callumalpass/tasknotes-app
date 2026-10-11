import { describe, expect, it } from "vitest";
import { activeScratchpads } from "./scratchpads";

function note(id: string, dateModified = "2026-07-01T00:00:00.000Z") {
  return {
    path: `scratchpads/${id}.md`,
    revision: `r-${id}`,
    types: ["tasknotes-scratch"],
    frontmatter: {
      type: "tasknotes-scratch",
      id,
      state: "active",
      title: `Title ${id}`,
      dateCreated: "2026-06-01T00:00:00.000Z",
      dateModified,
    },
    body: `Notes for ${id}\n`,
  };
}

describe("active scratchpad selection", () => {
  it("compares instants across timezone offsets and breaks ties consistently", () => {
    const earlier = note("earlier", "2026-07-01T10:00:00+02:00");
    const later = note("later", "2026-07-01T09:00:00Z");
    expect(activeScratchpads([earlier, later])[0].id).toBe("later");
    const a = note("a");
    const b = note("b");
    expect(activeScratchpads([b, a]).map((item) => item.id)).toEqual([
      "a",
      "b",
    ]);
    expect(activeScratchpads([a, b]).map((item) => item.id)).toEqual([
      "a",
      "b",
    ]);
  });
});
