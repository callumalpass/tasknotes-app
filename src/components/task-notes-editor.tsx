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
import { useLayoutEffect, useMemo, useRef } from "react";
import { taskNotesMarkdown } from "./task-notes-markdown";

const incoming = Annotation.define<boolean>();
const labelledNotes = EditorView.contentAttributes.of({
  "aria-labelledby": "task-notes-title",
  "aria-multiline": "true",
});

const notesExtensions = [
  labelledNotes,
  EditorView.lineWrapping,
  history(),
  keymap.of([...defaultKeymap, ...historyKeymap]),
  markdown({ base: markdownLanguage }),
  livePreview(),
];

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

  const contentExtensions = useMemo(
    () => [
      placeholder(hint),
      taskNotesMarkdown(resolveImage, { attached, loading, missing, failed }),
    ],
    [resolveImage, hint, attached, loading, missing, failed],
  );
  const initialContent = useRef(contentExtensions);

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
      root: host.current.getRootNode() as Document | ShadowRoot,
      state: EditorState.create({
        doc: latest.current.source,
        extensions: [
          notesExtensions,
          presentation.current.of(initialContent.current),
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
    // Install the configured editable subtree in one DOM write.
    host.current.append(view.dom);
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (view && presentation.current.get(view.state) !== contentExtensions)
      view.dispatch({
        effects: presentation.current.reconfigure(contentExtensions),
      });
  }, [contentExtensions]);

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
