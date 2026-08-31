import { autocompletion } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

import {
  recordWikilinkCompletionSource,
  type CompleteRecords,
} from "./markdown-wikilink-completion";

export function MarkdownSourceEditor({
  value,
  onChange,
  completeRecords,
  ariaLabel,
  autoFocus = false,
}: {
  value: string;
  onChange(value: string): void;
  completeRecords?: CompleteRecords;
  ariaLabel: string;
  autoFocus?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const initialValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const completeRecordsRef = useRef(completeRecords);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    completeRecordsRef.current = completeRecords;
  }, [completeRecords]);

  useEffect(() => {
    if (!hostRef.current) return;
    const completionSource = recordWikilinkCompletionSource(
      () => completeRecordsRef.current,
    );
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: [
          basicSetup,
          markdown(),
          autocompletion({
            activateOnTyping: true,
            override: [completionSource],
          }),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    if (autoFocus) view.contentDOM.focus({ preventScroll: true });
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, [ariaLabel, autoFocus]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  return <div className="markdown-source-editor" ref={hostRef} />;
}
