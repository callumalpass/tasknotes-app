import { describe, expect, it } from "vitest";

import {
  ensureOutlineContinuation,
  linkOutlineLine,
  moveOutlineSubtree,
  noteBodyToEdit,
  noteBodyToSave,
  outlineItems,
  outlineNodes,
  outlineSubtreeEnd,
  restoreOutlineDraft,
  trimmedNote,
} from "./scratch-outline";

const note = [
  "## Planning",
  "",
  "Some context first.",
  "",
  "- [ ] Book the room",
  "  - [x] Ask Sam",
  "  - a plain point",
  "- [[Tasks/Send agenda]]",
  "",
  "| a | b |",
  "| - | - |",
  "",
  "```",
  "- [ ] not a task",
  "```",
  "1. first",
].join("\n");

describe("outlineItems", () => {
  it("finds list items and leaves other Markdown alone", () => {
    const items = outlineItems(note);
    expect(
      items.map(({ line, depth, text, checked, link, marker }) => ({
        line,
        depth,
        text,
        checked,
        link,
        marker,
      })),
    ).toEqual([
      {
        line: 4,
        depth: 0,
        text: "Book the room",
        checked: false,
        link: undefined,
        marker: "-",
      },
      {
        line: 5,
        depth: 1,
        text: "Ask Sam",
        checked: true,
        link: undefined,
        marker: "-",
      },
      {
        line: 6,
        depth: 1,
        text: "a plain point",
        checked: undefined,
        link: undefined,
        marker: "-",
      },
      {
        line: 7,
        depth: 0,
        text: "[[Tasks/Send agenda]]",
        checked: undefined,
        link: "[[Tasks/Send agenda]]",
        marker: "-",
      },
      {
        line: 15,
        depth: 0,
        text: "first",
        checked: undefined,
        link: undefined,
        marker: "1.",
      },
    ]);
    const [first] = items;
    expect(note.slice(first!.from, first!.to)).toBe("- [ ] Book the room");
    expect(note.slice(first!.textFrom, first!.to)).toBe("Book the room");
    expect(note.slice(first!.contentFrom, first!.to)).toBe("[ ] Book the room");
    expect(outlineSubtreeEnd(items, 0)).toBe(3);
  });

  it("reads an empty item, a rule and tab indentation", () => {
    const items = outlineItems("- [ ] \n---\n- a\n\t- b\n-");
    expect(items.map(({ line, text, depth }) => [line, text, depth])).toEqual([
      [0, "", 0],
      [2, "a", 0],
      [3, "b", 1],
      [4, "", 0],
    ]);
    expect(items[0]!.checked).toBe(false);
  });

  it("turns items into nodes, resolving task links", () => {
    const nodes = outlineNodes(outlineItems(note), (link) =>
      link === "[[Tasks/Send agenda]]"
        ? { id: "task-1", title: "Send agenda" }
        : undefined,
    );
    expect(nodes.map(({ id, kind, text }) => [id, kind, text])).toEqual([
      ["line-4", "draft", "Book the room"],
      ["line-5", "draft", "Ask Sam"],
      ["line-6", "note", "a plain point"],
      ["line-7", "task", "Send agenda"],
      ["line-15", "note", "first"],
    ]);
    expect(nodes[1]!.completed).toBe(true);
    expect(nodes[3]).toMatchObject({
      link: "[[Tasks/Send agenda]]",
      taskId: "task-1",
    });
  });
});

describe("conversion edits", () => {
  it("links a line and restores it without touching the rest", () => {
    const linked = linkOutlineLine(note, 5, "[[Tasks/Ask Sam]]");
    expect(linked.split("\n")[5]).toBe("  - [[Tasks/Ask Sam]]");
    expect(linked.split("\n").filter((_, index) => index !== 5)).toEqual(
      note.split("\n").filter((_, index) => index !== 5),
    );
    expect(
      restoreOutlineDraft(linked, "[[Tasks/Ask Sam]]", {
        text: "Ask Sam",
        completed: true,
      }),
    ).toBe(note);
    expect(
      restoreOutlineDraft(note, "[[Tasks/Missing]]", { text: "x" }),
    ).toBeUndefined();
  });

  it("adds a place to continue after the whole branch", () => {
    const source = "- [ ] parent\n  - child\n\nAfter.";
    const next = ensureOutlineContinuation(source, 0);
    expect(next.source).toBe("- [ ] parent\n  - child\n- [ ] \n\nAfter.");
    expect(next.source.slice(0, next.caret)).toBe(
      "- [ ] parent\n  - child\n- [ ] ",
    );
  });

  it("reuses an empty item that already follows the branch", () => {
    const source = "- [ ] one\n- [ ] ";
    expect(ensureOutlineContinuation(source, 0)).toEqual({
      source,
      caret: source.length,
    });
  });

  it("continues a nested item at its own depth", () => {
    const next = ensureOutlineContinuation("- a\n  - [ ] b\n\nAfter.", 1);
    expect(next.source).toBe("- a\n  - [ ] b\n  - [ ] \n\nAfter.");
  });

  it("adds nothing when the list goes on below", () => {
    const source = "- [ ] one\n  - child\n- [ ] two";
    expect(ensureOutlineContinuation(source, 0)).toEqual({
      source,
      caret: "- [ ] one".length,
    });
  });
});

describe("moveOutlineSubtree", () => {
  const source = "- one\n  - inner\n- two\n- three\n\nAfter.";

  it("moves a branch past its sibling", () => {
    expect(moveOutlineSubtree(source, 0, 1)).toEqual({
      source: "- two\n- one\n  - inner\n- three\n\nAfter.",
      line: 1,
    });
    expect(moveOutlineSubtree(source, 3, -1)).toEqual({
      source: "- one\n  - inner\n- three\n- two\n\nAfter.",
      line: 2,
    });
  });

  it("stays put without a sibling in that direction", () => {
    expect(moveOutlineSubtree(source, 0, -1)).toBeUndefined();
    expect(moveOutlineSubtree(source, 3, 1)).toBeUndefined();
    expect(moveOutlineSubtree(source, 1, 1)).toBeUndefined();
  });
});

describe("saved text", () => {
  it("ignores empty lines and items at the end", () => {
    expect(trimmedNote("- a\n- [ ] \n\n")).toBe("- a");
    expect(noteBodyToSave("- a\n- [ ] ", "- a\n")).toBe("- a\n");
    expect(noteBodyToSave("- a\r\n", "- a")).toBe("- a");
    expect(noteBodyToSave("- a\n- b", "- a\n")).toBe("- a\n- b\n");
    expect(noteBodyToSave("- [ ] ", "")).toBe("");
    expect(noteBodyToEdit("- a\r\n- b\n\n")).toBe("- a\n- b");
  });
});
