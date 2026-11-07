import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { describe, expect, it } from "vitest";
import { readableWikilinks } from "./markdown-wikilink-decoration";

describe("readable source wikilinks", () => {
  const source =
    "Read [[Projects/Long path/Brief.md|the brief]] then [[Projects/Notes.md]].";
  function create() {
    return EditorState.create({
      doc: source,
      extensions: [markdown(), readableWikilinks],
    });
  }

  it("decorates aliases and basenames without changing a single Markdown byte", () => {
    const state = create();
    const labels: string[] = [];
    state
      .field(readableWikilinks)
      .between(0, source.length, (_from, _to, decoration) => {
        labels.push(decoration.spec.widget.label);
      });
    expect(labels).toEqual(["the brief", "Notes"]);
    expect(state.doc.toString()).toBe(source);
  });

  it("reveals source under every caret or intersecting selection and restores labels afterwards", () => {
    let state = create();
    for (const selection of [
      EditorSelection.cursor(15),
      EditorSelection.range(0, 20),
      EditorSelection.range(20, 0),
    ]) {
      state = state.update({ selection }).state;
      expect(state.field(readableWikilinks).size).toBe(1);
      expect(state.doc.toString()).toBe(source);
    }
    state = state.update({
      selection: EditorSelection.cursor(source.length),
    }).state;
    expect(state.field(readableWikilinks).size).toBe(2);
    expect(state.doc.toString()).toBe(source);
  });

  it("does not decorate inline or fenced code", () => {
    const state = EditorState.create({
      doc: "`[[Code/path]]`\n\n```md\n[[Code/fence]]\n```",
      extensions: [markdown(), readableWikilinks],
    });
    expect(state.field(readableWikilinks).size).toBe(0);
  });

  it("leaves escaped wikilinks and embeds in source form", () => {
    const state = EditorState.create({
      doc: String.raw`Literal \[[Projects/Notes]] and ![[Images/photo.png]]`,
      extensions: [markdown(), readableWikilinks],
    });
    expect(state.field(readableWikilinks).size).toBe(0);
  });
});
