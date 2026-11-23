import { EditorView } from "@codemirror/view";
import { act, screen } from "./render";

export function notesView(
  element = screen.getByRole("textbox", { name: "Notes" }),
) {
  const view = EditorView.findFromDOM(element);
  if (!view) throw new Error("Notes editor is not mounted");
  return view;
}

export function changeNotes(element: HTMLElement, source: string) {
  const view = notesView(element);
  act(() =>
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: source },
    }),
  );
}
