import { historyScope } from "./search-history";

import type { CollectionInfo } from "../application/ports/task-repository";
import type { Draft } from "./task-editor-draft";

/**
 * A copy of the task edits this device has not yet handed to mdbase.
 *
 * Saving a task goes through reads and the SDK before the write is captured on
 * the device, which a reload or a closed tab can interrupt. Each edit is
 * therefore written here synchronously, and removed only once mdbase has
 * captured the save (or the person discards it). On the next open, edits that
 * the task does not already show are offered back for review.
 */
export interface StoredTaskEdit {
  readonly version: 1;
  readonly savedAt: string;
  /** Only the fields that differ from the task as it was opened. */
  readonly fields: Partial<Draft>;
}

export interface TaskEditStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = "tasknotes:unsaved-task-edit:v1";

export function taskEditScope(info: CollectionInfo): string {
  return historyScope(info);
}

function key(scope: string, taskId: string): string {
  return `${PREFIX}:${scope}:${taskId}`;
}

function defaultStorage(): TaskEditStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/** The fields of `draft` that differ from `base`. */
export function changedFields(base: Draft, draft: Draft): Partial<Draft> {
  const out: Record<string, unknown> = {};
  for (const field of Object.keys(draft) as (keyof Draft)[])
    if (!same(base[field], draft[field])) out[field] = draft[field];
  return out as Partial<Draft>;
}

/** False when this browser cannot keep the copy (storage full or blocked). */
export function writeTaskEdit(
  scope: string,
  taskId: string,
  fields: Partial<Draft>,
  storage = defaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    if (!Object.keys(fields).length) storage.removeItem(key(scope, taskId));
    else
      storage.setItem(
        key(scope, taskId),
        JSON.stringify({
          version: 1,
          savedAt: new Date().toISOString(),
          fields,
        } satisfies StoredTaskEdit),
      );
    return true;
  } catch {
    // Storage can be full or blocked; the save itself still runs.
    return false;
  }
}

export function clearTaskEdit(
  scope: string,
  taskId: string,
  storage = defaultStorage(),
): void {
  try {
    storage?.removeItem(key(scope, taskId));
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

/**
 * The stored edits the task does not already show, or null. A stored edit the
 * task already shows was saved, so it is cleared.
 */
export function readTaskEdit(
  scope: string,
  taskId: string,
  current: Draft,
  storage = defaultStorage(),
): StoredTaskEdit | null {
  let stored: StoredTaskEdit | null = null;
  try {
    const raw = storage?.getItem(key(scope, taskId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTaskEdit>;
    if (
      parsed?.version === 1 &&
      parsed.fields &&
      typeof parsed.fields === "object"
    )
      stored = parsed as StoredTaskEdit;
  } catch {
    stored = null;
  }
  const fields = stored
    ? changedFields(current, { ...current, ...stored.fields })
    : {};
  if (!stored || !Object.keys(fields).length) {
    clearTaskEdit(scope, taskId, storage);
    return null;
  }
  return { ...stored, fields };
}
