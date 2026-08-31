import { autocompletion } from "@codemirror/autocomplete";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

import {
  recordWikilinkCompletionSource,
  type CompleteRecords,
} from "./markdown-wikilink-completion";

const scratchpadHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: "var(--ink)", fontWeight: "700" },
  {
    tag: [tags.link, tags.url],
    color: "var(--accent)",
    textDecoration: "underline",
  },
  {
    tag: [
      tags.meta,
      tags.processingInstruction,
      tags.punctuation,
      tags.bracket,
      tags.contentSeparator,
    ],
    color: "var(--ink-muted)",
  },
  { tag: tags.emphasis, color: "var(--ink-soft)", fontStyle: "italic" },
  { tag: tags.strong, color: "var(--ink)", fontWeight: "700" },
  { tag: [tags.monospace, tags.quote], color: "var(--ink-soft)" },
  { tag: tags.comment, color: "var(--ink-muted)" },
]);

function isDarkAppearance(): boolean {
  const theme = document.documentElement.dataset.theme;
  if (theme) return theme === "dark";
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function scratchpadEditorTheme(dark: boolean) {
  return EditorView.theme(
    {
      "&": {
        color: "var(--ink)",
        backgroundColor: "transparent",
      },
      ".cm-content": { caretColor: "var(--accent)" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
      ".cm-activeLine": {
        backgroundColor:
          "color-mix(in srgb, var(--accent-soft) 52%, transparent)",
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        backgroundColor: "color-mix(in srgb, var(--accent) 22%, transparent)",
      },
      ".cm-matchingBracket": {
        color: "var(--accent)",
        backgroundColor: "var(--accent-soft)",
        outline: "1px solid var(--accent)",
      },
      ".cm-searchMatch": {
        backgroundColor: "color-mix(in srgb, var(--accent) 18%, transparent)",
        outline: "1px solid var(--accent)",
      },
      ".cm-searchMatch.cm-searchMatch-selected": {
        backgroundColor: "color-mix(in srgb, var(--accent) 30%, transparent)",
      },
      ".cm-panels": {
        color: "var(--ink)",
        backgroundColor: "var(--paper-raised)",
      },
      ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--line)" },
      ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--line)" },
      ".cm-textfield": {
        color: "var(--ink)",
        backgroundColor: "var(--paper)",
        border: "1px solid var(--line-strong)",
      },
      ".cm-button": {
        color: "var(--ink)",
        backgroundColor: "var(--paper-soft)",
        backgroundImage: "none",
        border: "1px solid var(--line-strong)",
      },
      ".cm-tooltip": {
        color: "var(--ink)",
        backgroundColor: "var(--paper-raised)",
        border: "1px solid var(--line)",
        boxShadow: "0 12px 30px var(--color-shadow-soft)",
      },
      ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
        color: "var(--ink)",
        backgroundColor: "var(--accent-soft)",
      },
    },
    { dark },
  );
}

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
    const theme = new Compartment();
    let dark = isDarkAppearance();
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
          syntaxHighlighting(scratchpadHighlightStyle),
          theme.of(scratchpadEditorTheme(dark)),
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

    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const updateTheme = () => {
      const nextDark = isDarkAppearance();
      if (nextDark === dark) return;
      dark = nextDark;
      view.dispatch({
        effects: theme.reconfigure(scratchpadEditorTheme(dark)),
      });
    };
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    media?.addEventListener("change", updateTheme);

    if (autoFocus) view.contentDOM.focus({ preventScroll: true });
    return () => {
      observer.disconnect();
      media?.removeEventListener("change", updateTheme);
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
