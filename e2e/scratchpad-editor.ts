import type { Locator } from "@playwright/test";

/** The one editor inside a Scratchpad note. */
export function outlineOf(note: Locator, name = "Scratchpad outline"): Locator {
  return note.getByRole("textbox", { name, exact: true });
}

/** The note's Markdown as the editor holds it, not as it is drawn. */
export function noteText(editor: Locator): Promise<string | null> {
  return editor.evaluate((element) => {
    const tile = (
      element as unknown as {
        cmTile?: { view?: { state: { doc: { toString(): string } } } };
      }
    ).cmTile;
    return tile?.view?.state.doc.toString() ?? null;
  });
}
