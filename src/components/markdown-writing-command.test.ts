import { EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { describe, expect, it } from "vitest";
import { writingCommand } from "./markdown-writing-command";

describe("writing commands", () => {
  it.each(["bold", "italic", "link", "heading", "quote"] as const)(
    "preserves a backward selection for %s",
    (action) => {
      const state = EditorState.create({
        doc: "first\nsecond",
        selection: { anchor: 12, head: 0 },
      });
      const next = state.update(writingCommand(state, action)).state;
      expect(next.selection.main.anchor).toBeGreaterThan(
        next.selection.main.head,
      );
      expect(
        next.sliceDoc(next.selection.main.from, next.selection.main.to),
      ).toContain("first");
    },
  );

  it("keeps formatting and subsequent typing independently undoable", () => {
    let state = EditorState.create({ doc: "", extensions: [history()] });
    state = state.update({
      ...writingCommand(state, "bold"),
      userEvent: "input",
    }).state;
    state = state.update({
      changes: { from: 2, insert: "x" },
      selection: { anchor: 3 },
      userEvent: "input.type",
    }).state;
    const dispatch = (transaction: import("@codemirror/state").Transaction) => {
      state = transaction.state;
    };
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.doc.toString()).toBe("****");
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.doc.toString()).toBe("");
  });
  it("wraps only the selection and keeps it selected", () => {
    const state = EditorState.create({
      doc: "A small thought",
      selection: { anchor: 2, head: 7 },
    });
    const next = state.update(writingCommand(state, "bold")).state;
    expect(next.doc.toString()).toBe("A **small** thought");
    expect(
      next.sliceDoc(next.selection.main.from, next.selection.main.to),
    ).toBe("small");
  });
  it("places the caret inside an empty wikilink", () => {
    const state = EditorState.create({ doc: "" });
    const next = state.update(writingCommand(state, "link")).state;
    expect(next.doc.toString()).toBe("[[]]");
    expect(next.selection.main.head).toBe(2);
  });
  it("quotes selected lines without changing their text or the next line", () => {
    const state = EditorState.create({
      doc: "one\ntwo\nthree",
      selection: { anchor: 0, head: 8 },
    });
    const next = state.update(writingCommand(state, "quote")).state;
    expect(next.doc.toString()).toBe("> one\n> two\nthree");
  });
});
