/**
 * The outline inside a scratchpad note. The note is Markdown text and stays
 * the only record of itself; these functions find its list items and return a
 * changed copy of the text. Lines that are not list items are never rewritten.
 */

import { linkTarget } from "./completion";

import type { ScratchNode } from "./scratchpad";

export interface OutlineItem {
  /** Zero-based line number. */
  line: number;
  /** Offset of the line's first character. */
  from: number;
  /** Offset just past the line's last character. */
  to: number;
  /** Leading whitespace, as written. */
  indent: string;
  /** List marker, as written: `-`, `*`, `+`, `1.` or `1)`. */
  marker: string;
  /** Offset of whatever follows the marker: a checkbox or the text. */
  contentFrom: number;
  /** Checkbox state, when the item has a checkbox. */
  checked?: boolean;
  /** Offset of the item's text. */
  textFrom: number;
  text: string;
  depth: number;
  /** Set when the item's whole text is one record link. */
  link?: string;
}

/** What a linked line resolves to, when it names a task. */
export interface OutlineTask {
  id: string;
  title: string;
}

/** How a link, or a task's path, is compared with the links in a note. */
export function outlineTaskKey(link: string): string {
  return linkTarget(link).toLocaleLowerCase();
}

const ITEM =
  /^([ \t]*)([-*+]|\d{1,9}[.)])(?:([ \t]+)(?:\[([ xX])\](?=[ \t]|$)[ \t]*)?(.*))?$/;
const FENCE = /^[ \t]*(```|~~~)/;
const RULE = /^(?:[-*_][ \t]*){2,}$/;
const EMPTY_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+\[[ xX]\])?[ \t]*$/;

function columns(indent: string): number {
  return indent.replaceAll("\t", "    ").length;
}

function wholeLink(text: string): string | undefined {
  const source = text.trim();
  if (/^\[\[[^\]|]+(?:\|[^\]]+)?\]\]$/.test(source)) return source;
  if (/^\[[^\]]+\]\([^)]+\)$/.test(source)) return source;
}

/** Every list item in the note, in order, with its nesting depth. */
export function outlineItems(source: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const open: number[] = [];
  let offset = 0;
  let fenced = false;
  const lines = source.split("\n");
  for (let line = 0; line < lines.length; line += 1) {
    const raw = lines[line]!;
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const from = offset;
    offset += raw.length + 1;
    if (FENCE.test(text)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !text.trim()) continue;
    const match = ITEM.exec(text);
    if (!match || RULE.test(text.trim())) {
      // Unindented text that is not an item ends the list above it.
      if (!/^[ \t]/.test(text)) open.length = 0;
      continue;
    }
    const [, indent = "", marker = "-", gap = "", box, rest = ""] = match;
    const width = columns(indent);
    while (open.length && open.at(-1)! >= width) open.pop();
    const depth = open.length;
    open.push(width);
    const contentFrom = from + indent.length + marker.length + gap.length;
    const itemText = rest.trimEnd();
    const textFrom = from + text.length - rest.length;
    const link = wholeLink(itemText);
    items.push({
      line,
      from,
      to: from + text.length,
      indent,
      marker,
      contentFrom,
      ...(box === undefined ? {} : { checked: box !== " " }),
      textFrom,
      text: itemText,
      depth,
      ...(link ? { link } : {}),
    });
  }
  return items;
}

/** Index just past the item's last descendant. */
export function outlineSubtreeEnd(
  items: readonly OutlineItem[],
  index: number,
): number {
  const depth = items[index]?.depth;
  if (depth === undefined) return index;
  let end = index + 1;
  while (end < items.length && items[end]!.depth > depth) end += 1;
  return end;
}

export function outlineLineId(line: number): string {
  return `line-${line}`;
}

/**
 * The items as scratch nodes, for the code that turns drafts into tasks. A
 * line is a task when its whole text links to one; a checkbox makes a draft.
 */
export function outlineNodes(
  items: readonly OutlineItem[],
  taskFor: (link: string) => OutlineTask | undefined,
): ScratchNode[] {
  return items.map((item) => {
    const task = item.link ? taskFor(item.link) : undefined;
    if (task && item.link)
      return {
        id: outlineLineId(item.line),
        kind: "task",
        depth: item.depth,
        text: task.title,
        link: item.link,
        taskId: task.id,
      };
    return {
      id: outlineLineId(item.line),
      kind: item.checked === undefined ? "note" : "draft",
      depth: item.depth,
      text: item.text,
      ...(item.checked === undefined ? {} : { completed: item.checked }),
    };
  });
}

function replaceRange(
  source: string,
  from: number,
  to: number,
  insert: string,
): string {
  return `${source.slice(0, from)}${insert}${source.slice(to)}`;
}

/** The note with the item on `line` replaced by a link to its new task. */
export function linkOutlineLine(
  source: string,
  line: number,
  link: string,
): string {
  const item = outlineItems(source).find((entry) => entry.line === line);
  if (!item) throw new Error("The converted line is no longer in the note.");
  return replaceRange(source, item.contentFrom, item.to, link);
}

/**
 * The note with the first line that is only `link` turned back into the draft
 * it was made from. Returns nothing when no such line is left.
 */
export function restoreOutlineDraft(
  source: string,
  link: string,
  draft: Pick<ScratchNode, "text" | "completed">,
): string | undefined {
  const item = outlineItems(source).find((entry) => entry.link === link);
  if (!item) return;
  return replaceRange(
    source,
    item.contentFrom,
    item.to,
    `[${draft.completed ? "x" : " "}] ${draft.text.trim()}`,
  );
}

/** Last line that belongs to the item at `index`: its children and their text. */
function branchEndLine(
  lines: readonly string[],
  items: readonly OutlineItem[],
  index: number,
): number {
  const item = items[index]!;
  const next = items[outlineSubtreeEnd(items, index)];
  let end = next ? next.line - 1 : lines.length - 1;
  // Text that starts a new block after the list is not part of the branch.
  for (let line = item.line + 1; line <= end; line += 1) {
    const text = lines[line]!;
    if (text.trim() && !/^[ \t]/.test(text) && !ITEM.test(text)) {
      end = line - 1;
      break;
    }
  }
  while (end > item.line && !lines[end]!.trim()) end -= 1;
  return end;
}

/**
 * Where to keep writing after the item on `line` has become a task. At the end
 * of its list that is a new empty draft after the whole branch, never between
 * a parent and its children. With more of the list below, nothing is added and
 * the caret stays on the line.
 */
export function ensureOutlineContinuation(
  source: string,
  line: number,
): { source: string; caret: number } {
  const items = outlineItems(source);
  const index = items.findIndex((entry) => entry.line === line);
  if (index < 0)
    throw new Error("The converted line is no longer in the note.");
  const item = items[index]!;
  const next = items[outlineSubtreeEnd(items, index)];
  const lines = source.split("\n");
  const end = branchEndLine(lines, items, index);
  if (next && next.line === end + 1) {
    if (!next.text && next.depth === item.depth)
      return { source, caret: next.to };
    return { source, caret: item.to };
  }
  const marker = /\d/.test(item.marker) ? "-" : item.marker;
  const added = `${item.indent}${marker} [ ] `;
  lines.splice(end + 1, 0, added);
  const caret =
    lines.slice(0, end + 1).reduce((sum, text) => sum + text.length + 1, 0) +
    added.length;
  return { source: lines.join("\n"), caret };
}

/**
 * The note with the item on `line`, and everything under it, swapped with the
 * sibling above or below. Returns nothing when there is no such sibling.
 */
export function moveOutlineSubtree(
  source: string,
  line: number,
  direction: -1 | 1,
): { source: string; line: number } | undefined {
  const items = outlineItems(source);
  const index = items.findIndex((entry) => entry.line === line);
  if (index < 0) return;
  const item = items[index]!;
  let sibling = -1;
  if (direction === 1) {
    const next = outlineSubtreeEnd(items, index);
    if (items[next]?.depth === item.depth) sibling = next;
  } else {
    for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
      const depth = items[candidate]!.depth;
      if (depth < item.depth) break;
      if (depth === item.depth) {
        sibling = candidate;
        break;
      }
    }
  }
  if (sibling < 0) return;
  const lines = source.split("\n");
  const [upper, lower] = direction === 1 ? [index, sibling] : [sibling, index];
  const upperStart = items[upper]!.line;
  const lowerStart = items[lower]!.line;
  const lowerEnd = branchEndLine(lines, items, lower);
  // Lines between the two branches (blank lines) stay between them.
  const upperEnd = Math.min(branchEndLine(lines, items, upper), lowerStart - 1);
  const first = lines.slice(upperStart, upperEnd + 1);
  const between = lines.slice(upperEnd + 1, lowerStart);
  const second = lines.slice(lowerStart, lowerEnd + 1);
  const moved = [
    ...lines.slice(0, upperStart),
    ...second,
    ...between,
    ...first,
    ...lines.slice(lowerEnd + 1),
  ];
  return {
    source: moved.join("\n"),
    line:
      direction === 1
        ? upperStart + second.length + between.length
        : upperStart,
  };
}

/** The note without the empty lines and empty items left at its end. */
export function trimmedNote(source: string): string {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  while (lines.length) {
    const last = lines.at(-1)!;
    if (last.trim() && !EMPTY_ITEM.test(last)) break;
    lines.pop();
  }
  return lines.join("\n");
}

/**
 * What to save for the text in the editor. A note that differs from the saved
 * one only by an empty line or item at its end is not a change.
 */
export function noteBodyToSave(source: string, saved: string): string {
  const next = trimmedNote(source);
  if (next === trimmedNote(saved)) return saved;
  return next ? `${next}\n` : "";
}

/** The saved note as the editor shows it: no empty last line. */
export function noteBodyToEdit(body: string): string {
  return body.replaceAll("\r\n", "\n").replace(/\n+$/, "");
}
