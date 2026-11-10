import type { CompletionSource } from "@codemirror/autocomplete";
import type { NlpTriggerConfig } from "@tasknotes/model/types";

import {
  activeCaptureToken,
  applyCaptureSuggestion,
  captureSuggestionRequest,
  configuredCaptureSuggestions,
} from "../domain/capture-autosuggest";
import { activeRecordWikilink } from "../domain/record-wikilink-completion";
import { outlineItemAt } from "./scratch-outline-extension";

import type {
  FieldCompletion,
  FieldCompletionRequest,
} from "../domain/completion";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";

export interface CaptureCompletionContext {
  configuration: TaskCollectionConfiguration;
  triggers: NlpTriggerConfig[];
  complete(request: FieldCompletionRequest): Promise<FieldCompletion[]>;
}

/**
 * Suggestions for the capture shorthand of a draft line: a tag after `#`, a
 * project after `+`, and whatever else the collection has set up.
 */
export function captureCompletionSource(
  getContext: () => CaptureCompletionContext | undefined,
): CompletionSource {
  return async (context) => {
    const capture = getContext();
    const item = outlineItemAt(context.state, context.pos);
    if (!capture || !item || item.checked === undefined) return null;
    if (context.pos < item.textFrom) return null;
    if (activeRecordWikilink(context.state.doc.toString(), context.pos))
      return null;
    const text = context.state.sliceDoc(item.textFrom, item.to);
    const token = activeCaptureToken(
      text,
      context.pos - item.textFrom,
      capture.triggers,
    );
    if (!token) return null;
    const request = captureSuggestionRequest(token, capture.configuration);
    if (!request) return null;
    const configured = configuredCaptureSuggestions(request);
    const found = await capture.complete(request).catch(() => []);
    const values = found.length ? found : configured;
    if (context.aborted || !values.length) return null;
    return {
      from: item.textFrom + token.start,
      to: item.textFrom + token.end,
      filter: false,
      options: values.map((value) => ({
        label: value.label,
        detail: value.detail,
        apply(view) {
          const current = outlineItemAt(
            view.state,
            view.state.selection.main.head,
          );
          if (!current) return;
          const line = view.state.sliceDoc(current.textFrom, current.to);
          const next = applyCaptureSuggestion(line, token, value.value);
          view.dispatch({
            changes: {
              from: current.textFrom,
              to: current.to,
              insert: next.text,
            },
            selection: { anchor: current.textFrom + next.cursor },
            userEvent: "input.complete",
          });
        },
      })),
    };
  };
}
