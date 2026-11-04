const LIMIT = 20;

export interface UndoEntry {
  /** The task or batch named in the confirmation. */
  label: string;
  /** Shown with an Undo button when a change has no confirmation of its own. */
  notice?: string;
  undoNotice?: string;
  run(): Promise<unknown>;
}

let entries: UndoEntry[] = [];
const noticeListeners = new Set<(entry: UndoEntry) => void>();

/** Records a reversible edit for the app-wide Undo shortcut. */
export function rememberUndo(entry: UndoEntry) {
  entries = [...entries, entry].slice(-LIMIT);
  if (entry.notice) for (const listener of noticeListeners) listener(entry);
}

export function onUndoNotice(listener: (entry: UndoEntry) => void) {
  noticeListeners.add(listener);
  return () => {
    noticeListeners.delete(listener);
  };
}

/** Drops an entry that was undone another way, such as from its toast. */
export function forgetUndo(entry: UndoEntry) {
  entries = entries.filter((candidate) => candidate !== entry);
}

export function takeUndo(): UndoEntry | undefined {
  const entry = entries.at(-1);
  entries = entries.slice(0, -1);
  return entry;
}

/** Undo steps belong to one collection and never cross to another. */
export function clearUndoHistory() {
  entries = [];
}
