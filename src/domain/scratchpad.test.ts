import { describe, expect, it } from "vitest";

import {
  changeScratchDepth,
  moveScratchSubtree,
  nearestTaskAncestor,
  parseScratchBody,
  removeScratchNode,
  scratchpadPage,
  scratchpadPreview,
  scratchpadDocumentPath,
  serializeScratchNodes,
  visibleScratchNodes,
  type ScratchNode,
} from "./scratchpad";

describe("scratchpad Markdown outline", () => {
  it("gives every document a stable timestamped path", () => {
    expect(
      scratchpadDocumentPath(
        new Date("2026-08-06T06:30:12.345Z"),
        "12345678-abcd-efgh",
      ),
    ).toBe("TaskNotes/Scratchpad/2026-08-06T06-30-12.345Z – 12345678.md");
  });
  it("pages documents by immutable creation date and id, never modification date", () => {
    const documents = [
      scratchpad("a", "2026-08-01T10:00:00Z", "2026-09-01T10:00:00Z"),
      scratchpad("b", "2026-08-02T10:00:00Z", "2026-08-02T10:00:00Z"),
      scratchpad("c", "2026-08-02T10:00:00Z", "2026-08-03T10:00:00Z"),
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

  it("round-trips draft tasks, notes, links, and hierarchy", () => {
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
      { kind: "task", depth: 1, text: "Write the brief" },
      { kind: "draft", depth: 0, text: "Book the venue" },
    ]);
    expect(serializeScratchNodes(nodes)).toBe(source);
  });

  it("moves a complete subtree and normalizes it to the destination depth", () => {
    const nodes = outline();
    const moved = moveScratchSubtree(nodes, "parent", "target", "inside");

    expect(moved.map(({ id, depth }) => [id, depth])).toEqual([
      ["target", 0],
      ["parent", 1],
      ["child", 2],
      ["last", 0],
    ]);
  });

  it("indents and outdents a subtree without creating impossible depth jumps", () => {
    const nodes = outline();
    const indented = changeScratchDepth(nodes, "parent", 1);
    expect(indented[0]?.depth).toBe(0);
    expect(indented[1]?.depth).toBe(1);
    expect(indented[2]?.depth).toBe(2);

    expect(changeScratchDepth(nodes, "target", 1)).toEqual(nodes);

    const outdented = changeScratchDepth(nodes, "child", -1);
    expect(outdented.find((node) => node.id === "child")?.depth).toBe(0);
  });

  it("outdents children when their parent is removed", () => {
    const remaining = removeScratchNode(outline(), "parent");
    expect(remaining.map(({ id, depth }) => [id, depth])).toEqual([
      ["target", 0],
      ["child", 0],
      ["last", 0],
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

  it("hides only descendants of collapsed outline items", () => {
    const nodes = [
      node("parent", 0),
      node("child", 1),
      node("grandchild", 2),
      node("sibling", 0),
    ];

    expect(
      visibleScratchNodes(nodes, new Set(["parent"])).map(
        ({ node: visible, descendantCount }) => [visible.id, descendantCount],
      ),
    ).toEqual([
      ["parent", 2],
      ["sibling", 0],
    ]);
    expect(
      visibleScratchNodes(nodes, new Set(["child"])).map(
        ({ node: visible }) => visible.id,
      ),
    ).toEqual(["parent", "child", "sibling"]);
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

function outline(): ScratchNode[] {
  return [
    node("target", 0),
    node("parent", 0),
    node("child", 1),
    node("last", 0),
  ];
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
