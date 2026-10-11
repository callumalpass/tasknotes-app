import type { CollectionInfo } from "../application/ports/task-repository";
import { navigationViewScope } from "./navigation-views";

/**
 * Recent searches and recently opened tasks for the empty Search screen.
 * Both are per-device conveniences scoped to one collection, so task IDs from
 * another collection never resolve against this one.
 */
export const HISTORY_LIMIT = 5;
const SEARCHES_KEY = "tasknotes:recent-searches:v1";
const TASKS_KEY = "tasknotes:recent-tasks:v1";

export type HistoryKind = "searches" | "tasks";
type HistoryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function historyScope(info: CollectionInfo): string {
  return navigationViewScope(info);
}

function storageKey(kind: HistoryKind, scope: string): string {
  return `${kind === "searches" ? SEARCHES_KEY : TASKS_KEY}:${scope}`;
}

function defaultStorage(): HistoryStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readHistory(
  kind: HistoryKind,
  scope: string,
  storage: HistoryStorage | undefined = defaultStorage(),
): string[] {
  try {
    const value = JSON.parse(
      storage?.getItem(storageKey(kind, scope)) ?? "null",
    ) as unknown;
    return Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === "string")
          .slice(0, HISTORY_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function writeHistory(
  kind: HistoryKind,
  scope: string,
  entries: string[],
  storage: HistoryStorage | undefined,
): string[] {
  try {
    if (entries.length)
      storage?.setItem(storageKey(kind, scope), JSON.stringify(entries));
    else storage?.removeItem(storageKey(kind, scope));
  } catch {
    // History is optional; the current visit continues without it.
  }
  return entries;
}

/** Moves an entry to the front, dropping duplicates and the oldest overflow. */
export function rememberHistory(
  kind: HistoryKind,
  scope: string,
  entry: string,
  storage: HistoryStorage | undefined = defaultStorage(),
): string[] {
  const value = kind === "searches" ? entry.trim() : entry;
  if (!value) return readHistory(kind, scope, storage);
  const same = (item: string) =>
    kind === "searches"
      ? item.toLocaleLowerCase() === value.toLocaleLowerCase()
      : item === value;
  return writeHistory(
    kind,
    scope,
    [
      value,
      ...readHistory(kind, scope, storage).filter((item) => !same(item)),
    ].slice(0, HISTORY_LIMIT),
    storage,
  );
}

export function forgetHistory(
  kind: HistoryKind,
  scope: string,
  entries: readonly string[],
  storage: HistoryStorage | undefined = defaultStorage(),
): string[] {
  return writeHistory(
    kind,
    scope,
    readHistory(kind, scope, storage).filter((item) => !entries.includes(item)),
    storage,
  );
}

export function clearHistory(
  kind: HistoryKind,
  scope: string,
  storage: HistoryStorage | undefined = defaultStorage(),
): void {
  writeHistory(kind, scope, [], storage);
}

/** Records a task opening once its collection identity is known. */
export function rememberOpenedTask(
  repository: { collectionInfo(): Promise<CollectionInfo> },
  id: string,
): void {
  void repository
    .collectionInfo()
    .then((info) => rememberHistory("tasks", historyScope(info), id))
    .catch(() => undefined);
}
