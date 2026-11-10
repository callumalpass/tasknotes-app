import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { isRevealed, livePreviewReveal } from "@mdbase-dev/ui/live-preview";
import { linkDisplayLabel } from "../domain/completion";

class WikilinkLabel extends WidgetType {
  constructor(readonly label: string) {
    super();
  }

  eq(other: WikilinkLabel): boolean {
    return this.label === other.label;
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "scratchpad-wikilink-label";
    element.textContent = this.label;
    return element;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export function wikilinkDecorations(state: EditorState): DecorationSet {
  const source = state.doc.toString();
  const tree = syntaxTree(state);
  const live = state.field(livePreviewReveal, false) !== undefined;
  const ranges = [...source.matchAll(/\[\[([^\]\n]+)\]\]/g)].flatMap(
    (match) => {
      const from = match.index;
      const to = from + match[0].length;
      const prefix = source.slice(0, from).match(/\\+$/)?.[0].length ?? 0;
      if (prefix % 2 || source[from - 1] === "!") return [];
      // Beside the live preview the label follows its rule for showing
      // Markdown, so a link reads the same whether or not the note has focus.
      const showsSource = live
        ? isRevealed(state, from, to)
        : state.selection.ranges.some(
            (selection) => selection.from <= to && selection.to >= from,
          );
      if (showsSource) return [];
      let node = tree.resolveInner(from, 1);
      while (node.parent) {
        if (
          ["InlineCode", "CodeBlock", "FencedCode", "Link", "Image"].includes(
            node.name,
          )
        )
          return [];
        node = node.parent;
      }
      const label = match[1].includes("|")
        ? linkDisplayLabel(match[0])
        : linkDisplayLabel(match[0]).replace(/\.md(?=#|$)/i, "");
      return [
        Decoration.replace({ widget: new WikilinkLabel(label) }).range(
          from,
          to,
        ),
      ];
    },
  );
  return Decoration.set(ranges, true);
}

export const readableWikilinks = StateField.define<DecorationSet>({
  create: wikilinkDecorations,
  update: (_decorations, transaction) => wikilinkDecorations(transaction.state),
  provide: (field) => EditorView.decorations.from(field),
});
