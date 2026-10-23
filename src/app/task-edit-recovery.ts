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

/**
 * Follow a newer version of the task in every field without a local edit, and
 * return the draft to show, or null when it is unchanged.
 *
 * `known` holds the version the editor last saw, field by field. A field whose
 * draft differs from it is an edit in progress and is kept, unless it already
 * equals the incoming value (this editor's own save). With nothing unsaved or
 * saving (`pending` false), every local value has been saved, so any
 * difference from the incoming version is newer or normalised data. Adopted
 * fields also move `opened`, so they never count as this person's edit.
 */
export function followIncomingDraft(
  baselines: { known: { current: Draft }; opened: { current: Draft } },
  local: Draft,
  remote: Draft,
  pending: boolean,
): Draft | null {
  const { known, opened } = baselines;
  let adopted: Partial<Draft>;
  if (!pending) {
    adopted = changedFields(local, remote);
    known.current = remote;
  } else {
    const editedLocally = changedFields(known.current, local);
    const differsFromRemote = changedFields(remote, local);
    const nextKnown: Record<string, unknown> = { ...known.current };
    const fields: Record<string, unknown> = {};
    for (const field of Object.keys(changedFields(known.current, remote))) {
      if (field in editedLocally && field in differsFromRemote) continue;
      nextKnown[field] = remote[field as keyof Draft];
      if (!(field in editedLocally))
        fields[field] = remote[field as keyof Draft];
    }
    known.current = nextKnown as Draft;
    adopted = fields as Partial<Draft>;
  }
  if (!Object.keys(adopted).length) return null;
  opened.current = { ...opened.current, ...adopted };
  return { ...local, ...adopted };
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
 * The stored edits the task does not already show, or null. A matching value
 * is evidence of a save only when the record has no unconfirmed/refused write.
 * An optimistic device read can still be rolled back by a later rejection.
 */
export function readTaskEdit(
  scope: string,
  taskId: string,
  current: Draft,
  storage = defaultStorage(),
  unconfirmed = false,
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
    ? unconfirmed
      ? stored.fields
      : changedFields(current, { ...current, ...stored.fields })
    : {};
  if (!stored || !Object.keys(fields).length) {
    clearTaskEdit(scope, taskId, storage);
    return null;
  }
  return { ...stored, fields };
}
