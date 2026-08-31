import type { CompletionSource } from "@codemirror/autocomplete";

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
        const apply = recordWikilinkValue(value);
        return apply
          ? [
              {
                label: value.label,
                detail: value.detail,
                apply,
              },
            ]
          : [];
      }),
    };
  };
}
