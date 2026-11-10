import type { CompletionSource } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";

import {
  activeRecordWikilink,
  recordWikilinkCompletionRequest,
  recordWikilinkValue,
} from "../domain/record-wikilink-completion";

import type {
  FieldCompletion,
  FieldCompletionRequest,
} from "../domain/completion";

export type CompleteRecords = (
  request: FieldCompletionRequest,
) => Promise<FieldCompletion[]>;

export function recordWikilinkCompletionSource(
  getCompleteRecords: () => CompleteRecords | undefined,
  /** Called once a chosen link is in the text. */
  onApplied?: (
    view: EditorView,
    completion: FieldCompletion,
    link: string,
  ) => void,
): CompletionSource {
  return async (context) => {
    const token = activeRecordWikilink(
      context.state.doc.toString(),
      context.pos,
    );
    const complete = getCompleteRecords();
    if (!token || !complete) return null;
    let values: FieldCompletion[];
    try {
      values = await complete(recordWikilinkCompletionRequest(token));
    } catch {
      return null;
    }
    if (context.aborted) return null;
    return {
      from: token.from,
      to: token.to,
      filter: false,
      options: values.flatMap((value) => {
        const link = recordWikilinkValue(value);
        return link
          ? [
              {
                label: value.label,
                detail: value.detail,
                apply: onApplied
                  ? (
                      view: EditorView,
                      _option: unknown,
                      from: number,
                      to: number,
                    ) => {
                      view.dispatch({
                        changes: { from, to, insert: link },
                        selection: { anchor: from + link.length },
                        userEvent: "input.complete",
                      });
                      onApplied(view, value, link);
                    }
                  : link,
              },
            ]
          : [];
      }),
    };
  };
}
