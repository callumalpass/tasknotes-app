import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  Annotation,
  Compartment,
  EditorState,
  Transaction,
} from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { useLingui } from "@lingui/react/macro";
import { isLocale } from "@mdbase-dev/i18n";
import {
  englishCodeMirrorPhrases,
  loadCodeMirrorPhrases,
} from "@mdbase-dev/i18n/codemirror";
import { livePreview } from "@mdbase-dev/ui/live-preview";
import "@mdbase-dev/ui/live-preview.css";
import { useLayoutEffect, useRef } from "react";
import { taskNotesMarkdown } from "./task-notes-markdown";

const incoming = Annotation.define<boolean>();
const labelledNotes = EditorView.contentAttributes.of({
  "aria-labelledby": "task-notes-title",
  "aria-multiline": "true",
});

export function TaskNotesEditor({
  source,
  onChange,
  resolveImage,
}: {
  source: string;
  onChange(source: string): void;
  resolveImage(reference: string): Promise<Blob | null>;
}) {
  const { t, i18n } = useLingui();
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const latest = useRef({ source, onChange });
  const presentation = useRef(new Compartment());
  const language = useRef(new Compartment());
  const locale = i18n.locale;
  const hint = t`Add thoughts, links, or supporting details…`;
  const attached = t`Attached image`;
  const loading = t`Loading image…`;
  const missing = t`Image unavailable offline`;
  const failed = t`Image preview unavailable`;

  useLayoutEffect(() => {
    latest.current = { source, onChange };
    const view = viewRef.current;
    if (!view) return;
    const before = view.state.doc.toString();
    const after = source.replace(/\r\n?/g, "\n");
    if (before === after) return;
    let from = 0;
    let endBefore = before.length;
    let endAfter = after.length;
    while (from < endBefore && from < endAfter && before[from] === after[from])
      from++;
    while (
      endBefore > from &&
      endAfter > from &&
      before[endBefore - 1] === after[endAfter - 1]
    ) {
      endBefore--;
      endAfter--;
    }
    view.dispatch({
      changes: { from, to: endBefore, insert: after.slice(from, endAfter) },
      annotations: [incoming.of(true), Transaction.addToHistory.of(false)],
    });
  }, [source, onChange]);

  useLayoutEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: latest.current.source,
        extensions: [
          labelledNotes,
          EditorView.lineWrapping,
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown({ base: markdownLanguage }),
          livePreview(),
          presentation.current.of([]),
          language.current.of(EditorState.phrases.of(englishCodeMirrorPhrases)),
          EditorView.updateListener.of((update) => {
            if (
              !update.docChanged ||
              update.transactions.every(
                (transaction) =>
                  !transaction.docChanged || transaction.annotation(incoming),
              )
            )
              return;
            const lineEnding = latest.current.source.match(/\r\n|\n|\r/)?.[0];
            latest.current.onChange(
              update.state.doc.sliceString(0, undefined, lineEnding),
            );
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useLayoutEffect(() => {
    viewRef.current?.dispatch({
      effects: presentation.current.reconfigure([
        placeholder(hint),
        taskNotesMarkdown(resolveImage, { attached, loading, missing, failed }),
      ]),
    });
  }, [resolveImage, hint, attached, loading, missing, failed]);

  useLayoutEffect(() => {
    let active = true;
    void loadCodeMirrorPhrases(isLocale(locale) ? locale : "en")
      .then((phrases) => {
        if (active)
          viewRef.current?.dispatch({
            effects: language.current.reconfigure(
              EditorState.phrases.of(phrases),
            ),
          });
      })
      .catch((error: unknown) =>
        console.warn("Editor language could not load.", error),
      );
    return () => {
      active = false;
    };
  }, [locale]);

  return <div className="task-notes-editor" ref={host} />;
}
