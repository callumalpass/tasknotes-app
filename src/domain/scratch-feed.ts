import type { ScratchImage } from "./scratch-image";
import { scratchpadHistoryDate, type ScratchpadDocument } from "./scratchpad";

export type ScratchFeedItem =
  ({ kind: "scratchpad" } & ScratchpadDocument) | ScratchImage;

export interface ScratchFeedPageRequest {
  limit?: number;
  cursor?: string;
}

export interface ScratchFeedPage {
  current: ScratchpadDocument;
  items: ScratchFeedItem[];
  nextCursor?: string;
}

export function scratchpadFeedItem(
  document: ScratchpadDocument,
): ScratchFeedItem {
  return { kind: "scratchpad", ...document };
}

export function compareScratchFeedNewestFirst(
  left: ScratchFeedItem,
  right: ScratchFeedItem,
) {
  const leftDate = feedDate(left);
  const rightDate = feedDate(right);
  const leftTime = Date.parse(leftDate);
  const rightTime = Date.parse(rightDate);
  const byActivity =
    Number.isFinite(leftTime) && Number.isFinite(rightTime)
      ? rightTime - leftTime
      : rightDate.localeCompare(leftDate);
  return (
    byActivity ||
    right.id.localeCompare(left.id) ||
    right.kind.localeCompare(left.kind)
  );
}

export function scratchFeedPage(
  current: ScratchpadDocument,
  items: readonly ScratchFeedItem[],
  request: ScratchFeedPageRequest = {},
): ScratchFeedPage {
  const ordered = [...items]
    .filter((item) => item.kind === "image" || item.id !== current.id)
    .sort(compareScratchFeedNewestFirst);
  const limit = Math.max(1, Math.min(Math.floor(request.limit ?? 20), 100));
  let start = 0;
  if (request.cursor) {
    const key = decodeCursor(request.cursor);
    start = ordered.findIndex((item) => feedKey(item) === key);
    if (start < 0)
      throw new Error("The scratchpad feed page has expired. Reload it.");
    start += 1;
  }
  const page = ordered.slice(start, start + limit);
  const last = page.at(-1);
  return {
    current,
    items: page,
    ...(last && start + page.length < ordered.length
      ? { nextCursor: encodeURIComponent(feedKey(last)) }
      : {}),
  };
}

export function scratchFeedKey(item: ScratchFeedItem) {
  return `${item.kind}:${item.id}`;
}

function feedDate(item: ScratchFeedItem) {
  return item.kind === "scratchpad"
    ? scratchpadHistoryDate(item)
    : item.dateCreated;
}

function feedKey(item: ScratchFeedItem) {
  return JSON.stringify([feedDate(item), item.id, item.kind]);
}

function decodeCursor(cursor: string) {
  try {
    const value = decodeURIComponent(cursor);
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length === 3 &&
      parsed.every((part) => typeof part === "string")
    )
      return value;
  } catch {
    /* stable error below */
  }
  throw new Error("The scratchpad feed page is invalid. Reload it.");
}
