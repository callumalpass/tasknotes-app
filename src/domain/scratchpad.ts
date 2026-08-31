export const SCRATCHPAD_TYPE = "tasknotes-scratch";
export const SCRATCHPAD_FOLDER = "TaskNotes/Scratchpad";
export type ScratchpadState = "active" | "converted";
export type ScratchNodeKind = "draft" | "note" | "task";

export interface ScratchpadDocument {
  id: string;
  path: string;
  revision: string;
  state: ScratchpadState;
  dateCreated: string;
  dateModified: string;
  dateConverted?: string;
  title?: string;
  body: string;
}

export const SCRATCHPAD_PAGE_SIZE = 20;

export interface ScratchpadPageRequest {
  limit?: number;
  /** Opaque continuation returned by the preceding page. */
  cursor?: string;
}

export interface ScratchpadPage {
  documents: ScratchpadDocument[];
  nextCursor?: string;
}

export interface SaveScratchpadInput {
  id: string;
  path: string;
  revision: string;
  /** Exact body the editor loaded or received from its preceding save. */
  baseBody: string;
  body: string;
  /** Omit to preserve the title; pass an empty string to clear it. */
  title?: string;
}

export interface StartNewScratchpadInput extends SaveScratchpadInput {
  title?: string;
}

export interface StartNewScratchpadResult {
  previous: ScratchpadDocument;
  current: ScratchpadDocument;
}

/** @deprecated Use StartNewScratchpadInput. */
export type ArchiveScratchpadInput = StartNewScratchpadInput;
/** @deprecated Use StartNewScratchpadResult. */
export interface ScratchpadArchiveResult {
  archived: ScratchpadDocument;
  active: ScratchpadDocument;
}

export function compareScratchpadsNewestFirst(
  left: ScratchpadDocument,
  right: ScratchpadDocument,
): number {
  if (left.state !== right.state) return left.state === "active" ? -1 : 1;
  const leftTime = Date.parse(left.dateCreated);
  const rightTime = Date.parse(right.dateCreated);
  const byCreated =
    Number.isFinite(leftTime) && Number.isFinite(rightTime)
      ? rightTime - leftTime
      : right.dateCreated.localeCompare(left.dateCreated);
  return byCreated || right.id.localeCompare(left.id);
}

export function orderScratchpadsNewestFirst(
  documents: readonly ScratchpadDocument[],
): ScratchpadDocument[] {
  return [...documents].sort(compareScratchpadsNewestFirst);
}

export function scratchpadPreview(document: ScratchpadDocument): string {
  const text = parseScratchBody(document.body)
    .map((node) => node.text.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" · ");
  return text || "Empty scratchpad";
}

export function scratchpadPage(
  documents: readonly ScratchpadDocument[],
  request: ScratchpadPageRequest = {},
): ScratchpadPage {
  const ordered = orderScratchpadsNewestFirst(documents);
  const limit = Math.max(
    1,
    Math.min(Math.floor(request.limit ?? SCRATCHPAD_PAGE_SIZE), 100),
  );
  let start = 0;
  if (request.cursor) {
    const [dateCreated, id] = decodeScratchpadCursor(request.cursor);
    start = ordered.findIndex(
      (document) => document.dateCreated === dateCreated && document.id === id,
    );
    if (start < 0)
      throw new Error("The scratchpad page has expired. Reload it.");
    start += 1;
  }
  const documentsPage = ordered.slice(start, start + limit);
  const last = documentsPage.at(-1);
  return {
    documents: documentsPage,
    ...(last && start + documentsPage.length < ordered.length
      ? { nextCursor: encodeScratchpadCursor(last) }
      : {}),
  };
}

function encodeScratchpadCursor(document: ScratchpadDocument): string {
  return encodeURIComponent(
    JSON.stringify([document.dateCreated, document.id]),
  );
}

function decodeScratchpadCursor(cursor: string): [string, string] {
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(cursor));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      parsed.every((value) => typeof value === "string")
    )
      return parsed as [string, string];
  } catch {
    // Report one stable domain error below.
  }
  throw new Error("The scratchpad page is invalid. Reload it.");
}

export interface ScratchNode {
  id: string;
  kind: ScratchNodeKind;
  depth: number;
  text: string;
  /** Portable Markdown checkbox state for an unconverted draft task. */
  completed?: boolean;
  /** Exact record link candidate; hydration confirms whether it is a TaskNote. */
  link?: string;
  taskId?: string;
}

export interface VisibleScratchNode {
  node: ScratchNode;
  index: number;
  descendantCount: number;
}

export type ScratchDropPlacement = "before" | "after" | "inside";

export function parseScratchBody(body: string): ScratchNode[] {
  const duplicates = new Map<string, number>();
  return body.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    const match = /^(\s*)(?:[-*+]\s+)?([\s\S]*)$/.exec(line);
    if (!match) return [];
    const indentation = match[1].replaceAll("\t", "  ").length;
    const source = match[2].trim();
    const checkbox = /^\[([ xX])\]\s*(.*)$/.exec(source);
    const linked = linkedScratchValue(checkbox ? checkbox[2] : source);
    const kind: ScratchNodeKind = checkbox ? "draft" : "note";
    const text = checkbox?.[2].trim() ?? linked?.link ?? source;
    const fingerprint = `${kind}:${Math.floor(indentation / 2)}:${text}:${linked?.link ?? ""}`;
    const occurrence = (duplicates.get(fingerprint) ?? 0) + 1;
    duplicates.set(fingerprint, occurrence);
    return [
      {
        id: `line-${index}-${stableStringHash(fingerprint)}-${occurrence}`,
        kind,
        depth: Math.floor(indentation / 2),
        text,
        ...(kind === "draft" ? { completed: checkbox?.[1] !== " " } : {}),
        ...(linked ? { link: linked.link } : {}),
      },
    ];
  });
}

export function serializeScratchNodes(nodes: readonly ScratchNode[]): string {
  if (!nodes.length) return "";
  return `${nodes
    .map((node) => {
      const marker =
        node.kind === "draft"
          ? `[${node.completed ? "x" : " "}] ${node.text.trim()}`
          : node.kind === "task"
            ? (node.link ?? node.text.trim())
            : node.text.trim();
      return `${"  ".repeat(Math.max(0, node.depth))}- ${marker}`;
    })
    .join("\n")}\n`;
}

export function createScratchNode(
  kind: Exclude<ScratchNodeKind, "task"> = "draft",
  depth = 0,
  text = "",
): ScratchNode {
  return {
    id:
      globalThis.crypto?.randomUUID?.() ??
      `line-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind,
    depth: Math.max(0, depth),
    text,
  };
}

export function scratchSubtreeEnd(
  nodes: readonly ScratchNode[],
  index: number,
): number {
  const depth = nodes[index]?.depth;
  if (depth === undefined) return index;
  let end = index + 1;
  while (end < nodes.length && nodes[end]!.depth > depth) end += 1;
  return end;
}

export function visibleScratchNodes(
  nodes: readonly ScratchNode[],
  collapsedIds: ReadonlySet<string>,
): VisibleScratchNode[] {
  const visible: VisibleScratchNode[] = [];
  let collapsedDepth: number | undefined;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (collapsedDepth !== undefined) {
      if (node.depth > collapsedDepth) continue;
      collapsedDepth = undefined;
    }
    const descendantCount = scratchSubtreeEnd(nodes, index) - index - 1;
    visible.push({ node, index, descendantCount });
    if (descendantCount && collapsedIds.has(node.id))
      collapsedDepth = node.depth;
  }
  return visible;
}

export function moveScratchSubtree(
  nodes: readonly ScratchNode[],
  sourceId: string,
  targetId: string,
  placement: ScratchDropPlacement,
): ScratchNode[] {
  const sourceIndex = nodes.findIndex((node) => node.id === sourceId);
  const targetIndex = nodes.findIndex((node) => node.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex)
    return [...nodes];
  const sourceEnd = scratchSubtreeEnd(nodes, sourceIndex);
  if (targetIndex >= sourceIndex && targetIndex < sourceEnd) return [...nodes];

  const subtree = nodes.slice(sourceIndex, sourceEnd);
  const remaining = [...nodes.slice(0, sourceIndex), ...nodes.slice(sourceEnd)];
  const remainingTarget = remaining.findIndex((node) => node.id === targetId);
  if (remainingTarget < 0) return [...nodes];
  const target = remaining[remainingTarget]!;
  const insertion =
    placement === "before"
      ? remainingTarget
      : placement === "inside"
        ? remainingTarget + 1
        : scratchSubtreeEnd(remaining, remainingTarget);
  const nextDepth = placement === "inside" ? target.depth + 1 : target.depth;
  const depthDelta = nextDepth - subtree[0]!.depth;
  const moved = subtree.map((node) => ({
    ...node,
    depth: Math.max(0, node.depth + depthDelta),
  }));
  return [
    ...remaining.slice(0, insertion),
    ...moved,
    ...remaining.slice(insertion),
  ];
}

export function changeScratchDepth(
  nodes: readonly ScratchNode[],
  id: string,
  direction: -1 | 1,
): ScratchNode[] {
  const index = nodes.findIndex((node) => node.id === id);
  if (index < 0) return [...nodes];
  const node = nodes[index]!;
  const maximum = index ? nodes[index - 1]!.depth + 1 : 0;
  const nextDepth = Math.max(0, Math.min(node.depth + direction, maximum));
  if (nextDepth === node.depth) return [...nodes];
  const end = scratchSubtreeEnd(nodes, index);
  const delta = nextDepth - node.depth;
  return nodes.map((candidate, candidateIndex) =>
    candidateIndex >= index && candidateIndex < end
      ? { ...candidate, depth: candidate.depth + delta }
      : candidate,
  );
}

export function removeScratchNode(
  nodes: readonly ScratchNode[],
  id: string,
): ScratchNode[] {
  const index = nodes.findIndex((node) => node.id === id);
  if (index < 0) return [...nodes];
  const depth = nodes[index]!.depth;
  const end = scratchSubtreeEnd(nodes, index);
  return nodes.flatMap((node, candidateIndex) => {
    if (candidateIndex === index) return [];
    if (candidateIndex > index && candidateIndex < end)
      return [{ ...node, depth: Math.max(depth, node.depth - 1) }];
    return [node];
  });
}

export function nearestTaskAncestor(
  nodes: readonly ScratchNode[],
  index: number,
): ScratchNode | undefined {
  const depth = nodes[index]?.depth ?? 0;
  let maximumDepth = depth;
  for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
    const node = nodes[candidate]!;
    if (node.depth >= maximumDepth) continue;
    maximumDepth = node.depth;
    if (node.kind === "task") return node;
    if (maximumDepth === 0) return;
  }
}

export function scratchpadDocumentPath(now: Date, id: string): string {
  const timestamp = now.toISOString().replaceAll(":", "-");
  return `${SCRATCHPAD_FOLDER}/${timestamp} – ${id.slice(0, 8)}.md`;
}

export const SCRATCHPAD_TYPE_DOCUMENT = `---
kind: mdbase.type
name: tasknotes-scratch
version: 1
description: A working outline managed by TaskNotes.
match:
  where:
    type:
      eq: tasknotes-scratch
schema:
  dialect: json-schema-2020-12
  value:
    $schema: https://json-schema.org/draft/2020-12/schema
    type: object
    additionalProperties: true
    required: [type, id, state, dateCreated, dateModified]
    properties:
      type:
        const: tasknotes-scratch
      id:
        type: string
        minLength: 1
      state:
        enum: [active, converted]
      title:
        type: string
      dateCreated:
        type: string
        format: date-time
      dateModified:
        type: string
        format: date-time
      dateConverted:
        type: string
        format: date-time
collection:
  path:
    folder: TaskNotes/Scratchpad
    template: "{{id}}"
  display:
    name_field: title
  unique:
    - field: id
      scope: type
lifecycle:
  on_create:
    set:
      id:
        uuid: true
      dateCreated:
        now: true
      dateModified:
        now: true
  on_update:
    set:
      dateModified:
        now: true
---
# TaskNotes scratchpad

Scratchpads are Markdown outlines. Checkbox items are draft tasks, plain
bullets are notes, and links point to TaskNotes created from the outline.
`;

function linkedScratchValue(source: string): { link: string } | undefined {
  const wikilink = /^(\[\[[^\]|]+(?:\|[^\]]+)?\]\])$/.exec(source);
  if (wikilink) return { link: wikilink[1] };
  const markdown = /^(\[[^\]]+\]\([^)]+\))$/.exec(source);
  if (markdown) return { link: markdown[1] };
}

function stableStringHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
