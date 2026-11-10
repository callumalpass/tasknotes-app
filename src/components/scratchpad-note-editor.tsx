import { useLingui } from "@lingui/react/macro";
import { isLocale } from "@mdbase-dev/i18n";
import {
  englishCodeMirrorPhrases,
  loadCodeMirrorPhrases,
} from "@mdbase-dev/i18n/codemirror";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  HighlightStyle,
  foldKeymap,
  syntaxHighlighting,
} from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  keymap,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import {
  indentListItem,
  livePreview,
  outdentListItem,
} from "@mdbase-dev/ui/live-preview";
import "@mdbase-dev/ui/live-preview.css";
import { observeTheme, resolveDarkTheme } from "@mdbase-dev/ui/theme";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Bold,
  CornerDownRight,
  CornerUpLeft,
  FileCheck2,
  Heading2,
  Italic,
  Link,
  ListTodo,
  Quote,
} from "lucide-react";
import { ensureOutlineContinuation } from "../domain/scratch-outline";
import { writingCommand, type WritingAction } from "./markdown-writing-command";
import { readableWikilinks } from "./markdown-wikilink-decoration";
import {
  captureCompletionSource,
  type CaptureCompletionContext,
} from "./scratch-capture-completion";
import {
  canMoveOutlineItem,
  moveOutlineItem,
  outlineItemAt,
  outlineLineKind,
  replaceEditorText,
  scratchOutline,
  setOutlinePreview,
  setOutlineTasks,
  toggleTaskItem,
  type OutlineHooks,
  type OutlinePreview,
  type OutlineTaskView,
} from "./scratch-outline-extension";

import {
  recordWikilinkCompletionSource,
  type CompleteRecords,
} from "./markdown-wikilink-completion";

const scratchpadHighlightStyle = HighlightStyle.define([
  // Heading sizes come from the live preview's line styles.
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
  { tag: tags.quote, color: "var(--ink-soft)" },
  {
    tag: tags.monospace,
    color: "var(--ink-soft)",
    fontFamily: '"Azeret Mono", ui-monospace, monospace',
    fontSize: "0.88em",
  },
  { tag: tags.comment, color: "var(--ink-muted)" },
]);

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

/** The line the caret is on, for the app's controls and the typing preview. */
export interface ScratchCaretLine {
  line: number;
  kind: "task" | "draft" | "note" | "text";
  text: string;
  depth: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export interface ScratchpadNoteEditorHandle {
  focus(): void;
  text(): string;
  /** Shows text that came from outside: a load, or another device. */
  setText(text: string): void;
  /** Changes the text as an edit, keeping the caret and undo history. */
  replaceText(next: string, caret?: number): void;
}

/** What the outline needs from the app, beyond its names for things. */
export interface ScratchpadNoteEditorActions {
  createTask(line: number): void;
  openTask(link: string): void;
  toggleTask(link: string): void;
  /** A link to a task was chosen for a line of its own. */
  taskLinked(taskId: string): void;
  foldLabel(open: boolean, text: string, nested: number): string;
  nestedLabel(count: number): string;
  createTaskLabel(text: string): string;
}

function sameCaretLine(
  left: ScratchCaretLine | null,
  right: ScratchCaretLine | null,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.line === right.line &&
    left.kind === right.kind &&
    left.text === right.text &&
    left.depth === right.depth &&
    left.canMoveUp === right.canMoveUp &&
    left.canMoveDown === right.canMoveDown
  );
}

/**
 * A scratchpad note: Markdown that reads as rendered text and behaves as an
 * outline. The text belongs to the editor; the app is told when it changes.
 */
/**
 * The editor loads after the page, so someone may already be in a menu, a
 * field or an earlier note by the time it would take focus.
 */
function focusIsInUse(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body)
    return false;
  return (
    active.isContentEditable ||
    active.matches("input, textarea, select") ||
    Boolean(
      active.closest(
        '[role="menu"], [role="dialog"], [role="listbox"], .scratchpad-history',
      ),
    )
  );
}

export function ScratchpadNoteEditor({
  initialText,
  onChange,
  onCaretLine,
  completeRecords,
  capture,
  tasks,
  preview,
  actions,
  ariaLabel,
  autoFocus = false,
  readOnly = false,
  handle,
}: {
  initialText: string;
  onChange(text: string): void;
  onCaretLine?(line: ScratchCaretLine | null): void;
  completeRecords?: CompleteRecords;
  capture?: CaptureCompletionContext;
  tasks: ReadonlyMap<string, OutlineTaskView>;
  preview: OutlinePreview | null;
  actions: ScratchpadNoteEditorActions;
  ariaLabel: string;
  autoFocus?: boolean;
  readOnly?: boolean;
  handle?: Ref<ScratchpadNoteEditorHandle>;
}) {
  const { t, i18n } = useLingui();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const initialTextRef = useRef(initialText);
  const onChangeRef = useRef(onChange);
  const onCaretLineRef = useRef(onCaretLine);
  const completeRecordsRef = useRef(completeRecords);
  const captureRef = useRef(capture);
  const actionsRef = useRef(actions);
  const tasksRef = useRef(tasks);
  const caretLineRef = useRef<ScratchCaretLine | null>(null);
  const language = useRef(new Compartment());
  const accessibility = useRef(new Compartment());
  const editable = useRef(new Compartment());
  const [focused, setFocused] = useState(false);
  const [caretLine, setCaretLine] = useState<ScratchCaretLine | null>(null);
  const locale = i18n.locale;
  const labels = {
    createTask: t({ message: "Create task" }),
    details: t({ message: "Recognized task details" }),
    prompt: t({ message: "What needs doing?" }),
  };
  const labelsRef = useRef(labels);

  useEffect(() => {
    onChangeRef.current = onChange;
    onCaretLineRef.current = onCaretLine;
    completeRecordsRef.current = completeRecords;
    captureRef.current = capture;
    actionsRef.current = actions;
    labelsRef.current = labels;
  });

  useImperativeHandle(
    handle,
    () => ({
      focus: () => viewRef.current?.contentDOM.focus({ preventScroll: true }),
      text: () => viewRef.current?.state.doc.toString() ?? "",
      setText(text) {
        const view = viewRef.current;
        if (!view || view.state.doc.toString() === text) return;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
          selection: { anchor: text.length },
        });
      },
      replaceText(next, caret) {
        if (viewRef.current) replaceEditorText(viewRef.current, next, caret);
      },
    }),
    [],
  );

  useEffect(() => {
    if (!hostRef.current) return;
    const hooks = (): OutlineHooks => ({
      createTask: (line) => actionsRef.current.createTask(line),
      openTask: (link) => actionsRef.current.openTask(link),
      toggleTask: (link) => actionsRef.current.toggleTask(link),
      createTaskLabel: (text) => actionsRef.current.createTaskLabel(text),
      createTaskTitle: () => labelsRef.current.createTask,
      detailsLabel: () => labelsRef.current.details,
      foldLabel: (open, text, nested) =>
        actionsRef.current.foldLabel(open, text, nested),
      nestedLabel: (count) => actionsRef.current.nestedLabel(count),
      emptyPrompt: () => labelsRef.current.prompt,
    });
    const wikilinks = recordWikilinkCompletionSource(
      () => completeRecordsRef.current,
      (view, completion, link) => {
        // A task linked on a line of its own becomes that line.
        const item = outlineItemAt(view.state, view.state.selection.main.head);
        if (!completion.taskId || !item || item.text !== link) return;
        actionsRef.current.taskLinked(completion.taskId);
        const source = view.state.doc.toString();
        const bare =
          item.checked === undefined
            ? source
            : `${source.slice(0, item.contentFrom)}${source.slice(item.textFrom)}`;
        const next = ensureOutlineContinuation(bare, item.line);
        replaceEditorText(view, next.source, next.caret, "input.complete");
      },
    );
    const captureSuggestions = captureCompletionSource(
      () => captureRef.current,
    );
    const theme = new Compartment();
    let dark = resolveDarkTheme();
    const reportCaret = (view: EditorView) => {
      const { state } = view;
      const item = outlineItemAt(state, state.selection.main.head);
      const next: ScratchCaretLine = {
        line: state.doc.lineAt(state.selection.main.head).number - 1,
        kind: outlineLineKind(state),
        text: item?.text ?? "",
        depth: item?.depth ?? 0,
        canMoveUp: canMoveOutlineItem(state, -1),
        canMoveDown: canMoveOutlineItem(state, 1),
      };
      if (sameCaretLine(caretLineRef.current, next)) return;
      caretLineRef.current = next;
      setCaretLine(next);
      onCaretLineRef.current?.(next);
    };
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialTextRef.current,
        selection: { anchor: initialTextRef.current.length },
        extensions: [
          keymap.of([
            {
              key: "Mod-b",
              run: () => {
                format("bold");
                return true;
              },
            },
            {
              key: "Mod-i",
              run: () => {
                format("italic");
                return true;
              },
            },
          ]),
          // Tab nests a list item; anywhere else it still moves focus on.
          Prec.high(
            keymap.of([
              { key: "Tab", run: indentListItem },
              { key: "Shift-Tab", run: outdentListItem },
            ]),
          ),
          history(),
          drawSelection(),
          dropCursor(),
          closeBrackets(),
          autocompletion({
            activateOnTyping: true,
            override: [wikilinks, captureSuggestions],
          }),
          scratchOutline(hooks),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...foldKeymap,
          ]),
          // GitHub-flavoured Markdown, for tasks, strikethrough and tables.
          markdown({ base: markdownLanguage }),
          // The note reads as rendered text; Markdown shows at the caret.
          livePreview(),
          Prec.high(readableWikilinks),
          syntaxHighlighting(scratchpadHighlightStyle),
          theme.of(scratchpadEditorTheme(dark)),
          EditorView.lineWrapping,
          editable.current.of([]),
          accessibility.current.of([]),
          language.current.of(EditorState.phrases.of(englishCodeMirrorPhrases)),
          // The editor's own focus update is dropped when another change
          // lands with it, as a tap's does, so the events are read directly.
          EditorView.domEventHandlers({
            focus(_event, target) {
              setFocused(true);
              reportCaret(target);
            },
            blur() {
              setFocused(false);
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              onChangeRef.current(update.state.doc.toString());
            if (update.docChanged || update.selectionSet)
              reportCaret(update.view);
          }),
        ],
      }),
    });
    viewRef.current = view;
    view.dispatch({ effects: setOutlineTasks.of(tasksRef.current) });

    const updateTheme = () => {
      const nextDark = resolveDarkTheme();
      if (nextDark === dark) return;
      dark = nextDark;
      view.dispatch({
        effects: theme.reconfigure(scratchpadEditorTheme(dark)),
      });
    };
    const stopObservingTheme = observeTheme(updateTheme);

    if (autoFocus && !focusIsInUse())
      view.contentDOM.focus({ preventScroll: true });
    setFocused(view.hasFocus);
    return () => {
      stopObservingTheme();
      viewRef.current = null;
      view.destroy();
    };
  }, [autoFocus]);

  useEffect(() => {
    tasksRef.current = tasks;
    viewRef.current?.dispatch({ effects: setOutlineTasks.of(tasks) });
  }, [tasks]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setOutlinePreview.of(preview) });
  }, [preview]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editable.current.reconfigure(
        // Still focusable: a task being created must not close the keyboard.
        readOnly ? [EditorState.readOnly.of(true)] : [],
      ),
    });
  }, [readOnly, autoFocus]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: accessibility.current.reconfigure(
        EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
      ),
    });
  }, [ariaLabel, autoFocus]);

  useEffect(() => {
    // Reconfigure without resetting document text, selection or undo history.
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
  }, [locale, autoFocus]);

  function format(action: WritingAction) {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      ...writingCommand(view.state, action),
      scrollIntoView: true,
      userEvent: "input",
    });
    view.contentDOM.focus({ preventScroll: true });
  }

  function run(command: (view: EditorView) => boolean) {
    const view = viewRef.current;
    if (!view) return;
    command(view);
    view.contentDOM.focus({ preventScroll: true });
  }

  const kind = caretLine?.kind ?? "text";
  const tools = [
    {
      key: "task",
      label:
        kind === "draft"
          ? t({ message: "Convert to note" })
          : t({ message: "Make a task" }),
      Icon: ListTodo,
      disabled: kind === "task",
      pressed: kind === "draft",
      act: () => run(toggleTaskItem),
    },
    {
      key: "outdent",
      label: t({ message: "Outdent" }),
      Icon: CornerUpLeft,
      disabled: kind === "text" || !caretLine?.depth,
      act: () => run(outdentListItem),
    },
    {
      key: "indent",
      label: t({ message: "Indent" }),
      Icon: CornerDownRight,
      disabled: kind === "text",
      act: () => run(indentListItem),
    },
    {
      key: "up",
      label: t({ message: "Move up" }),
      Icon: ArrowUp,
      disabled: !caretLine?.canMoveUp,
      act: () => run(moveOutlineItem(-1)),
    },
    {
      key: "down",
      label: t({ message: "Move down" }),
      Icon: ArrowDown,
      disabled: !caretLine?.canMoveDown,
      act: () => run(moveOutlineItem(1)),
    },
    {
      key: "create",
      label: t({ message: "Create task" }),
      Icon: FileCheck2,
      disabled: kind !== "draft" || !caretLine?.text,
      act: () => {
        if (caretLine) actions.createTask(caretLine.line);
      },
    },
    {
      key: "heading",
      label: t({ message: "Heading" }),
      Icon: Heading2,
      act: () => format("heading"),
    },
    {
      key: "bold",
      label: t({ message: "Bold" }),
      Icon: Bold,
      act: () => format("bold"),
    },
    {
      key: "italic",
      label: t({ message: "Italic" }),
      Icon: Italic,
      act: () => format("italic"),
    },
    {
      key: "quote",
      label: t({ message: "Quote" }),
      Icon: Quote,
      act: () => format("quote"),
    },
    {
      key: "link",
      label: t({ message: "Wikilink" }),
      Icon: Link,
      act: () => format("link"),
    },
  ];

  return (
    <div className="scratchpad-note-surface">
      <div
        className="markdown-source-editor scratchpad-note-text"
        ref={hostRef}
      />
      {focused ? (
        <div
          className="scratchpad-note-tools"
          role="toolbar"
          aria-label={t({ message: "Writing tools" })}
        >
          {tools.map(({ key, label, Icon, disabled, pressed, act }) => (
            <button
              key={key}
              type="button"
              aria-label={label}
              aria-pressed={pressed}
              disabled={disabled || readOnly}
              title={label}
              onPointerDown={(event) => event.preventDefault()}
              onClick={act}
            >
              <Icon aria-hidden="true" size={18} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
