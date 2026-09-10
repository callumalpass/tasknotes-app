import { isolateHistory } from "@codemirror/commands";
import type { EditorState } from "@codemirror/state";

export type WritingAction = "bold" | "italic" | "heading" | "quote" | "link";

/** Only explicit writing commands change syntax; ordinary typing stays exact. */
export function writingCommand(state: EditorState, action: WritingAction) {
  const { from, to, anchor, head } = state.selection.main;
  if (action === "heading" || action === "quote") {
    const prefix = action === "heading" ? "## " : "> ";
    const first = state.doc.lineAt(from);
    const last = state.doc.lineAt(to > from ? to - 1 : to);
    const changes = [];
    for (let number = first.number; number <= last.number; number += 1)
      changes.push({ from: state.doc.line(number).from, insert: prefix });
    const mapped = state.changes(changes);
    return {
      changes,
      annotations: isolateHistory.of("full"),
      selection: {
        anchor: mapped.mapPos(anchor, 1),
        head: mapped.mapPos(head, 1),
      },
    };
  }
  const marker = action === "bold" ? "**" : action === "italic" ? "*" : "[[";
  const closing = action === "link" ? "]]" : marker;
  return {
    changes: { from, to, insert: marker + state.sliceDoc(from, to) + closing },
    annotations: isolateHistory.of("full"),
    selection: { anchor: anchor + marker.length, head: head + marker.length },
  };
}
