import { describe, expect, it } from "vitest";

import {
  nearestTaskAncestor,
  parseScratchBody,
  scratchpadPage,
  scratchpadPreview,
  type ScratchNode,
} from "./scratchpad";

describe("scratchpad Markdown outline", () => {
  it("pages history by latest use with creation-date fallback and stable ids", () => {
    const documents = [
      scratchpad("a", "2026-08-01T10:00:00Z", "2026-09-01T10:00:00Z"),
      scratchpad("b", "2026-08-02T10:00:00Z", "2026-08-02T10:00:00Z"),
      {
        ...scratchpad("c", "2026-08-02T10:00:00Z", "2026-08-03T10:00:00Z"),
        dateConverted: "2026-09-03T10:00:00Z",
      },
    ];
    const first = scratchpadPage(documents, { limit: 2 });
    expect(first.documents.map(({ id }) => id)).toEqual(["c", "b"]);
    expect(
      scratchpadPage(documents, {
        limit: 2,
        cursor: first.nextCursor,
      }).documents.map(({ id }) => id),
    ).toEqual(["a"]);
  });

  it("orders RFC3339 dates by their instant and pins the current target", () => {
    const current = {
      ...scratchpad("current", "2026-07-01T00:00:00Z", "2026-07-01T00:00:00Z"),
      state: "active" as const,
    };
    const page = scratchpadPage([
      scratchpad(
        "later-offset",
        "2026-08-02T00:00:00-10:00",
        "2026-08-02T00:00:00-10:00",
      ),
      scratchpad("earlier-z", "2026-08-02T09:00:00Z", "2026-08-02T09:00:00Z"),
      current,
    ]);
    expect(page.documents.map(({ id }) => id)).toEqual([
      "current",
      "later-offset",
      "earlier-z",
    ]);
  });

  it("builds a compact plain-outline preview", () => {
    expect(
      scratchpadPreview({
        ...scratchpad("a", "2026-08-01T10:00:00Z", "2026-08-01T10:00:00Z"),
        body: "- [ ] First\n  - Context\n- [ ] Third\n- Fourth\n",
      }),
    ).toBe("First · Context · Third");
  });

  it("reads draft tasks, notes, links, and hierarchy", () => {
    const source = `- [ ] Plan launch tomorrow 9am
  - Keep the announcement concise
  - [[tasks/brief|Write the brief]]
- [x] Book the venue
`;

    const nodes = parseScratchBody(source);

    expect(
      nodes.map(({ kind, depth, text }) => ({ kind, depth, text })),
    ).toEqual([
      { kind: "draft", depth: 0, text: "Plan launch tomorrow 9am" },
      { kind: "note", depth: 1, text: "Keep the announcement concise" },
      {
        kind: "note",
        depth: 1,
        text: "[[tasks/brief|Write the brief]]",
      },
      { kind: "draft", depth: 0, text: "Book the venue" },
    ]);
  });

  it("finds the nearest converted task ancestor through note nodes", () => {
    const nodes: ScratchNode[] = [
      node("linked", 0, "task"),
      node("context", 1, "note"),
      node("draft", 2, "draft"),
    ];
    expect(nearestTaskAncestor(nodes, 2)?.id).toBe("linked");
  });
});

function scratchpad(id: string, dateCreated: string, dateModified: string) {
  return {
    id,
    path: `scratchpads/${id}.md`,
    revision: "r1",
    state: "converted" as const,
    dateCreated,
    dateModified,
    body: "",
  };
}

function node(
  id: string,
  depth: number,
  kind: ScratchNode["kind"] = "draft",
): ScratchNode {
  return {
    id,
    depth,
    kind,
    text: id,
    ...(kind === "task" ? { link: `[[tasks/${id}]]` } : {}),
  };
}
