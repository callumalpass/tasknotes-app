/**
 * What makes the scratchpad's Markdown editor an outline: lines that link to
 * a task read as that task, a draft line can become a task where it stands,
 * branches fold and move, and the keys behave as they do in an outliner.
 * The text stays plain Markdown throughout.
 */

import {
  codeFolding,
  foldable,
  foldEffect,
  foldedRanges,
  unfoldEffect,
} from "@codemirror/language";
import {
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  ViewPlugin,
  WidgetType,
  gutter,
  keymap,
  type DecorationSet,
  type Rect,
} from "@codemirror/view";
import { outdentListItem } from "@mdbase-dev/ui/live-preview";

import {
  moveOutlineSubtree,
  outlineItems,
  outlineSubtreeEnd,
  outlineTaskKey,
  trimmedNote,
  type OutlineItem,
} from "../domain/scratch-outline";

/** A task as its line shows it. */
export interface OutlineTaskView {
  title: string;
  completed: boolean;
  /** Short facts shown after the title: a date, a priority. */
  details: readonly string[];
  /** The collection's colour for the task's priority, when it marks one. */
  color?: string;
}

/** What typing on a draft line has been recognised as so far. */
export interface OutlinePreview {
  line: number;
  text: string;
  details: readonly string[];
}

/** The app's side of the outline: what the lines do and how they are named. */
export interface OutlineHooks {
  createTask(line: number): void;
  openTask(link: string): void;
  toggleTask(link: string): void;
  createTaskLabel(text: string): string;
  createTaskTitle(): string;
  detailsLabel(): string;
  foldLabel(open: boolean, text: string, nested: number): string;
  nestedLabel(count: number): string;
  emptyPrompt(): string;
}

const itemCache = new WeakMap<Text, OutlineItem[]>();

/** The note's list items, read once per version of the text. */
export function outlineOf(state: EditorState): OutlineItem[] {
  let items = itemCache.get(state.doc);
  if (!items) {
    items = outlineItems(state.doc.toString());
    itemCache.set(state.doc, items);
  }
  return items;
}

/** The list item on the line that holds `position`. */
export function outlineItemAt(
  state: EditorState,
  position: number,
): OutlineItem | undefined {
  const line = state.doc.lineAt(position).number - 1;
  return outlineOf(state).find((item) => item.line === line);
}

export const setOutlineTasks =
  StateEffect.define<ReadonlyMap<string, OutlineTaskView>>();

export const outlineTasks = StateField.define<
  ReadonlyMap<string, OutlineTaskView>
>({
  create: () => new Map(),
  update(value, transaction) {
    for (const effect of transaction.effects)
      if (effect.is(setOutlineTasks)) return effect.value;
    return value;
  },
});

export const setOutlinePreview = StateEffect.define<OutlinePreview | null>();

const outlinePreview = StateField.define<OutlinePreview | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects)
      if (effect.is(setOutlinePreview)) return effect.value;
    return value;
  },
});

function taskOf(
  state: EditorState,
  item: OutlineItem,
): OutlineTaskView | undefined {
  if (!item.link) return;
  return state.field(outlineTasks, false)?.get(outlineTaskKey(item.link));
}

/** Where task links start, so other link decorations leave them alone. */
export function outlineTaskLinkStarts(state: EditorState): Set<number> {
  const starts = new Set<number>();
  if (!state.field(outlineTasks, false)?.size) return starts;
  for (const item of outlineOf(state))
    if (taskOf(state, item)) starts.add(item.textFrom);
  return starts;
}

function icon(paths: readonly string[], size: number): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

const CREATE_TASK_ICON = [
  "M10.5 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v6",
  "M14 2v5a1 1 0 0 0 1 1h5",
  "m14 20 2 2 4-4",
];
const CHEVRON_ICON = ["m9 18 6-6-6-6"];

/** A linked task in place of its link: the title opens it. */
class TaskChip extends WidgetType {
  constructor(
    readonly link: string,
    readonly task: OutlineTaskView,
    readonly hooks: () => OutlineHooks,
  ) {
    super();
  }

  eq(other: TaskChip): boolean {
    return (
      this.link === other.link &&
      this.task.title === other.task.title &&
      this.task.completed === other.task.completed &&
      this.task.color === other.task.color &&
      this.task.details.join("\0") === other.task.details.join("\0")
    );
  }

  toDOM(): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "cm-scratch-chip";
    const title = document.createElement("button");
    title.type = "button";
    title.tabIndex = -1;
    title.className = "cm-scratch-task-title";
    title.textContent = this.task.title;
    title.addEventListener("mousedown", (event) => event.preventDefault());
    title.addEventListener("click", (event) => {
      event.preventDefault();
      this.hooks().openTask(this.link);
    });
    chip.append(title);
    if (this.task.details.length) {
      const details = document.createElement("span");
      details.className = "cm-scratch-task-details";
      for (const detail of this.task.details) {
        const entry = document.createElement("span");
        entry.textContent = detail;
        details.append(entry);
      }
      chip.append(details);
    }
    return chip;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Where the caret goes at the end of a line that carries something after its
 * text. The editor would otherwise draw it against what follows, which sits at
 * the far end of the line or on the row below.
 */
function endOfLineText(widget: HTMLElement): Rect | null {
  let node: Node | null = widget.previousSibling;
  while (
    node instanceof HTMLElement &&
    node.matches(".cm-scratch-details, .cm-scratch-create, .cm-widgetBuffer")
  )
    node = node.previousSibling;
  if (!node) return null;
  const range = document.createRange();
  range.selectNodeContents(node);
  const rects = range.getClientRects();
  for (let index = rects.length - 1; index >= 0; index -= 1) {
    const rect = rects[index]!;
    if (rect.bottom > rect.top)
      return {
        left: rect.right,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
  }
  return null;
}

/** Turns the draft on its line into a task. */
class CreateTaskButton extends WidgetType {
  constructor(
    readonly line: number,
    readonly text: string,
    readonly hooks: () => OutlineHooks,
  ) {
    super();
  }

  eq(other: CreateTaskButton): boolean {
    return this.line === other.line && this.text === other.text;
  }

  toDOM(): HTMLElement {
    const hooks = this.hooks();
    const button = document.createElement("button");
    button.type = "button";
    button.tabIndex = -1;
    button.className = "cm-scratch-create";
    button.title = hooks.createTaskTitle();
    button.setAttribute("aria-label", hooks.createTaskLabel(this.text));
    button.append(icon(CREATE_TASK_ICON, 17));
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      this.hooks().createTask(this.line);
    });
    return button;
  }

  coordsAt(dom: HTMLElement): Rect | null {
    return endOfLineText(dom);
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** The date, priority and so on recognised in a draft as it is typed. */
class DraftDetails extends WidgetType {
  constructor(
    readonly details: readonly string[],
    readonly hooks: () => OutlineHooks,
  ) {
    super();
  }

  eq(other: DraftDetails): boolean {
    return this.details.join("\0") === other.details.join("\0");
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "cm-scratch-details";
    element.setAttribute("aria-label", this.hooks().detailsLabel());
    for (const detail of this.details) {
      const entry = document.createElement("span");
      entry.textContent = detail;
      element.append(entry);
    }
    return element;
  }

  coordsAt(dom: HTMLElement): Rect | null {
    return endOfLineText(dom);
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** The prompt on the first line of a note that has nothing in it yet. */
class EmptyPrompt extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: EmptyPrompt): boolean {
    return this.text === other.text;
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "cm-scratch-prompt";
    element.textContent = this.text;
    return element;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

interface OutlineDecorations {
  all: DecorationSet;
  /** Task chips: the caret steps over them as one character. */
  atomic: DecorationSet;
}

function buildDecorations(
  state: EditorState,
  hooks: () => OutlineHooks,
): OutlineDecorations {
  const items = outlineOf(state);
  const preview = state.field(outlinePreview, false);
  const head = state.selection.main.head;
  const activeLine = state.doc.lineAt(head).number - 1;
  const ranges: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  const onlyEmptyItem =
    items.length === 1 &&
    state.doc.lines === 1 &&
    !trimmedNote(state.doc.toString());
  for (const item of items) {
    const active = item.line === activeLine;
    const task = taskOf(state, item);
    // Bulleted lines step in by one marker a level, so a line's mark sits
    // under its parent's words whether either is a task or a plain point.
    const bulleted = /^[-*+]$/.test(item.marker);
    const depth = `--scratch-depth: ${item.depth}`;
    if (task && item.link) {
      // The circle takes a checkbox's room, so task and draft text line up.
      // A colour comes from the collection's settings; only a plain colour
      // value is written into the line's style.
      const color =
        task.color && !task.completed && /^[#\w(),.%\s/-]+$/.test(task.color)
          ? task.color
          : undefined;
      ranges.push(
        Decoration.line({
          class: `cm-scratch-item cm-scratch-task${task.completed ? " is-done" : ""}${color ? " has-priority" : ""}${active ? " cm-scratch-active" : ""}`,
          attributes: {
            style: color ? `${depth}; --priority-color: ${color}` : depth,
          },
        }).range(item.from),
      );
      const chip = Decoration.replace({
        widget: new TaskChip(item.link, task, hooks),
      }).range(item.textFrom, item.to);
      ranges.push(chip);
      atomic.push(chip);
      continue;
    }
    if (item.checked !== undefined && item.text) {
      ranges.push(
        Decoration.line({
          class: `${bulleted ? "cm-scratch-item " : ""}cm-scratch-draft${active ? " cm-scratch-active" : ""}`,
          attributes: { style: depth },
        }).range(item.from),
      );
      if (
        preview &&
        preview.line === item.line &&
        preview.text === item.text &&
        preview.details.length
      )
        ranges.push(
          Decoration.widget({
            widget: new DraftDetails(preview.details, hooks),
            side: 1,
          }).range(item.to),
        );
      ranges.push(
        Decoration.widget({
          widget: new CreateTaskButton(item.line, item.text, hooks),
          side: 2,
        }).range(item.to),
      );
      continue;
    }
    if (bulleted)
      ranges.push(
        Decoration.line({
          class: "cm-scratch-item",
          attributes: { style: depth },
        }).range(item.from),
      );
    if (onlyEmptyItem && item.checked !== undefined)
      ranges.push(
        Decoration.widget({
          widget: new EmptyPrompt(hooks().emptyPrompt()),
          side: 1,
        }).range(item.to),
      );
  }
  return {
    all: Decoration.set(ranges, true),
    atomic: Decoration.set(atomic, true),
  };
}

/** Replaces the note's text, changing only the part that differs. */
export function replaceEditorText(
  view: EditorView,
  next: string,
  caret?: number,
  userEvent = "input",
): void {
  const current = view.state.doc.toString();
  if (current === next) {
    if (caret !== undefined)
      view.dispatch({ selection: { anchor: caret }, scrollIntoView: true });
    return;
  }
  let start = 0;
  const limit = Math.min(current.length, next.length);
  while (start < limit && current[start] === next[start]) start += 1;
  let end = 0;
  while (
    end < limit - start &&
    current[current.length - 1 - end] === next[next.length - 1 - end]
  )
    end += 1;
  view.dispatch({
    changes: {
      from: start,
      to: current.length - end,
      insert: next.slice(start, next.length - end),
    },
    ...(caret === undefined
      ? {}
      : { selection: { anchor: Math.min(caret, next.length) } }),
    scrollIntoView: caret !== undefined,
    userEvent,
  });
}

/** Moves the item at the caret, with everything under it, past its sibling. */
export function moveOutlineItem(direction: -1 | 1) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const head = state.selection.main.head;
    const item = outlineItemAt(state, head);
    if (!item) return false;
    const moved = moveOutlineSubtree(
      state.doc.toString(),
      item.line,
      direction,
    );
    if (!moved) return true;
    const start = moved.source
      .split("\n")
      .slice(0, moved.line)
      .reduce((sum, text) => sum + text.length + 1, 0);
    replaceEditorText(view, moved.source, start + (head - item.from), "move");
    return true;
  };
}

/** Whether the item at the caret has a sibling to move past. */
export function canMoveOutlineItem(
  state: EditorState,
  direction: -1 | 1,
): boolean {
  const item = outlineItemAt(state, state.selection.main.head);
  return Boolean(
    item && moveOutlineSubtree(state.doc.toString(), item.line, direction),
  );
}

/**
 * Makes the caret's line a task, or a task a plain bullet. Text that is not in
 * a list becomes a task where it stands.
 */
export function toggleTaskItem(view: EditorView): boolean {
  const { state } = view;
  const head = state.selection.main.head;
  const item = outlineItemAt(state, head);
  if (!item) {
    const line = state.doc.lineAt(head);
    const indent = /^[ \t]*/.exec(line.text)![0].length;
    view.dispatch({
      changes: { from: line.from + indent, insert: "- [ ] " },
      userEvent: "input",
    });
    return true;
  }
  if (taskOf(state, item)) return false;
  view.dispatch({
    changes:
      item.checked === undefined
        ? { from: item.contentFrom, insert: "[ ] " }
        : { from: item.contentFrom, to: item.textFrom, insert: "" },
    userEvent: "input",
  });
  return true;
}

/** What the caret's line is, for controls outside the editor. */
export function outlineLineKind(
  state: EditorState,
): "task" | "draft" | "note" | "text" {
  const item = outlineItemAt(state, state.selection.main.head);
  if (!item) return "text";
  if (taskOf(state, item)) return "task";
  return item.checked === undefined ? "note" : "draft";
}

function backspaceAtItemStart(view: EditorView): boolean {
  const { state } = view;
  const selection = state.selection.main;
  if (!selection.empty) return false;
  const item = outlineItemAt(state, selection.head);
  if (!item || selection.head !== item.textFrom) return false;
  if (!item.text && item.from > 0) {
    // An empty line under another line is simply taken away.
    view.dispatch({
      changes: { from: item.from - 1, to: item.to },
      selection: { anchor: item.from - 1 },
      scrollIntoView: true,
      userEvent: "delete.backward",
    });
    return true;
  }
  if (item.depth > 0) return outdentListItem(view);
  // At the top level the marker goes and the words stay, as plain text.
  view.dispatch({
    changes: { from: item.from, to: item.textFrom },
    selection: { anchor: item.from },
    userEvent: "delete.backward",
  });
  return true;
}

/**
 * Enter on an empty item steps out of the list one level at a time, and at
 * the top level leaves an empty line to write on.
 */
function enterOnEmptyItem(view: EditorView): boolean {
  const { state } = view;
  const selection = state.selection.main;
  if (!selection.empty) return false;
  const item = outlineItemAt(state, selection.head);
  if (!item || item.text || selection.head < item.contentFrom) return false;
  if (item.depth > 0) return outdentListItem(view);
  // Text straight under an item would still belong to it, so an empty line
  // is kept between the list and what is written next.
  const above = item.line > 0 ? state.doc.line(item.line).text : "";
  const insert = above.trim() ? "\n" : "";
  view.dispatch({
    changes: { from: item.from, to: item.to, insert },
    selection: { anchor: item.from + insert.length },
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

/** After a linked task, Enter starts the next draft rather than a bullet. */
function enterAfterTask(view: EditorView): boolean {
  const { state } = view;
  const selection = state.selection.main;
  if (!selection.empty) return false;
  const item = outlineItemAt(state, selection.head);
  if (!item || !taskOf(state, item) || selection.head !== item.to) return false;
  const marker = /\d/.test(item.marker) ? "-" : item.marker;
  const insert = `\n${item.indent}${marker} [ ] `;
  view.dispatch({
    changes: { from: item.to, insert },
    selection: { anchor: item.to + insert.length },
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

function foldAt(
  state: EditorState,
  from: number,
  to: number,
): { from: number; to: number } | undefined {
  let found: { from: number; to: number } | undefined;
  foldedRanges(state).between(from, to, (start, end) => {
    if (!found && start >= from && start <= to)
      found = { from: start, to: end };
  });
  return found;
}

/** What folds on a line: an item with items under it, or a heading. */
function foldTarget(
  state: EditorState,
  lineFrom: number,
  lineTo: number,
): { text: string; nested: number } | undefined {
  const line = state.doc.lineAt(lineFrom);
  const items = outlineOf(state);
  const index = items.findIndex((item) => item.line === line.number - 1);
  if (index >= 0) {
    const nested = outlineSubtreeEnd(items, index) - index - 1;
    if (!nested) return;
    const item = items[index]!;
    return { text: taskOf(state, item)?.title ?? item.text, nested };
  }
  const heading = /^#{1,6}[ \t]+(.*)$/.exec(state.sliceDoc(lineFrom, lineTo));
  return heading ? { text: heading[1]!, nested: 0 } : undefined;
}

class FoldMarker extends GutterMarker {
  constructor(
    readonly open: boolean,
    readonly label: string,
  ) {
    super();
  }

  eq(other: FoldMarker): boolean {
    return this.open === other.open && this.label === other.label;
  }

  toDOM(): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.tabIndex = -1;
    button.className = `cm-scratch-fold${this.open ? "" : " is-folded"}`;
    button.setAttribute("aria-expanded", String(this.open));
    button.setAttribute("aria-label", this.label);
    button.append(icon(CHEVRON_ICON, 15));
    return button;
  }
}

function toggleFold(view: EditorView, lineFrom: number, lineTo: number) {
  const folded = foldAt(view.state, lineFrom, lineTo);
  if (folded) {
    view.dispatch({ effects: unfoldEffect.of(folded) });
    return true;
  }
  const range = foldable(view.state, lineFrom, lineTo);
  if (!range) return false;
  // The caret must not be left inside what is now hidden.
  const head = view.state.selection.main.head;
  view.dispatch({
    effects: foldEffect.of(range),
    ...(head > range.from && head <= range.to
      ? { selection: { anchor: range.from } }
      : {}),
  });
  return true;
}

/**
 * CodeMirror hides its margins from assistive technology. This one holds the
 * fold buttons, so it is shown again once it exists.
 */
const exposeFoldColumn = ViewPlugin.define((view) => {
  let exposed = false;
  const expose = () => {
    if (exposed) return;
    const margin = view.dom.querySelector(".cm-gutters");
    if (!margin) return;
    margin.removeAttribute("aria-hidden");
    exposed = true;
  };
  expose();
  return { update: expose };
});

function foldColumn(hooks: () => OutlineHooks): Extension {
  return gutter({
    class: "cm-scratch-fold-gutter",
    lineMarker(view, line) {
      const target = foldTarget(view.state, line.from, line.to);
      if (!target) return null;
      const folded = foldAt(view.state, line.from, line.to);
      if (!folded && !foldable(view.state, line.from, line.to)) return null;
      return new FoldMarker(
        !folded,
        hooks().foldLabel(!folded, target.text, target.nested),
      );
    },
    lineMarkerChange: (update) =>
      update.docChanged ||
      foldedRanges(update.startState) !== foldedRanges(update.state) ||
      update.startState.field(outlineTasks, false) !==
        update.state.field(outlineTasks, false),
    domEventHandlers: {
      mousedown(view, line, event) {
        event.preventDefault();
        return toggleFold(view, line.from, line.to);
      },
    },
  });
}

/** The outline behaviour for a scratchpad note's editor. */
export function scratchOutline(hooks: () => OutlineHooks): Extension {
  const decorations = StateField.define<OutlineDecorations>({
    create: (state) => buildDecorations(state, hooks),
    update(value, transaction) {
      const changed =
        transaction.docChanged ||
        transaction.selection !== undefined ||
        transaction.effects.some(
          (effect) =>
            effect.is(setOutlineTasks) || effect.is(setOutlinePreview),
        );
      return changed ? buildDecorations(transaction.state, hooks) : value;
    },
    provide: (field) => [
      EditorView.decorations.from(field, (value) => value.all),
      EditorView.atomicRanges.of(
        (view) => view.state.field(field, false)?.atomic ?? Decoration.none,
      ),
    ],
  });

  // The mark before a linked task is that task's own completion circle.
  const taskMarks = ViewPlugin.define((view) => {
    const toggle = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const mark = target?.closest?.(".cm-lp-list-prefix");
      if (!mark || !mark.closest(".cm-scratch-task")) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.type !== "click") return;
      const item = outlineItemAt(view.state, view.posAtDOM(mark));
      if (item?.link && taskOf(view.state, item)) hooks().toggleTask(item.link);
    };
    // The shared preview draws the mark as a hidden bullet; here it is a
    // checkbox, so it is named and its state is said.
    const describe = () => {
      for (const mark of view.dom.querySelectorAll<HTMLElement>(
        ".cm-scratch-task .cm-lp-bullet",
      )) {
        const item = outlineItemAt(view.state, view.posAtDOM(mark));
        const task = item && taskOf(view.state, item);
        if (!task) continue;
        mark.removeAttribute("aria-hidden");
        mark.setAttribute("role", "checkbox");
        mark.setAttribute("aria-checked", String(task.completed));
        mark.setAttribute("aria-label", task.title);
      }
    };
    view.dom.addEventListener("mousedown", toggle, true);
    view.dom.addEventListener("click", toggle, true);
    const measure = {
      key: "scratch-task-marks",
      read: () => null,
      write: describe,
    };
    view.requestMeasure(measure);
    return {
      update() {
        // After the lines have been redrawn for this change.
        view.requestMeasure(measure);
      },
      destroy() {
        view.dom.removeEventListener("mousedown", toggle, true);
        view.dom.removeEventListener("click", toggle, true);
      },
    };
  });

  return [
    outlineTasks,
    outlinePreview,
    Prec.high(decorations),
    taskMarks,
    codeFolding({
      preparePlaceholder: (state, range) =>
        outlineOf(state).filter(
          (item) => item.from > range.from && item.from <= range.to,
        ).length,
      placeholderDOM(_view, onclick, prepared: number) {
        const element = document.createElement("button");
        element.type = "button";
        element.tabIndex = -1;
        element.className = "cm-scratch-folded";
        element.textContent = prepared ? String(prepared) : "…";
        if (prepared) element.title = hooks().nestedLabel(prepared);
        element.addEventListener("click", onclick);
        return element;
      },
    }),
    foldColumn(hooks),
    exposeFoldColumn,
    Prec.highest(
      keymap.of([
        { key: "Backspace", run: backspaceAtItemStart },
        { key: "Enter", run: enterOnEmptyItem },
        { key: "Enter", run: enterAfterTask },
        { key: "Alt-ArrowUp", run: moveOutlineItem(-1) },
        { key: "Alt-ArrowDown", run: moveOutlineItem(1) },
        {
          key: "Mod-Enter",
          run(view) {
            const item = outlineItemAt(
              view.state,
              view.state.selection.main.head,
            );
            if (!item) return false;
            // On a task this completes it; on a draft it makes the task.
            if (item.link && taskOf(view.state, item)) {
              hooks().toggleTask(item.link);
              return true;
            }
            if (item.checked === undefined || !item.text) return false;
            hooks().createTask(item.line);
            return true;
          },
        },
      ]),
    ),
    // `[] ` at the start of a line makes it a task.
    EditorView.inputHandler.of((view, from, to, text) => {
      if (text !== " " || from !== to || view.composing) return false;
      const line = view.state.doc.lineAt(from);
      const before = line.text.slice(0, from - line.from);
      const match = /^([ \t]*)(?:([-*+])[ \t]+)?\[ ?\]$/.exec(before);
      if (!match) return false;
      const start = line.from + match[1]!.length;
      const insert = `${match[2] ?? "-"} [ ] `;
      view.dispatch({
        changes: { from: start, to: from, insert },
        selection: { anchor: start + insert.length },
        userEvent: "input.type",
      });
      return true;
    }),
  ];
}
