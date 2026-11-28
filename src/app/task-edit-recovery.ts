import { historyScope } from "./search-history";

import type { CollectionInfo } from "../application/ports/task-repository";
import type { UpdateTaskInput } from "../domain/task";
import type { Draft } from "./task-editor-draft";

/** Only explicit editor changes. Null represents a clear, including after JSON storage. */
export type TaskEdit = Pick<
  UpdateTaskInput,
  keyof Draft | "customPropertyPatch"
>;

export function mergeTaskEdits(first: TaskEdit, second: TaskEdit): TaskEdit {
  return {
    ...first,
    ...second,
    ...(first.customPropertyPatch && second.customPropertyPatch
      ? {
          customPropertyPatch: {
            ...first.customPropertyPatch,
            ...second.customPropertyPatch,
          },
        }
      : {}),
  };
}

export function applyTaskEdit(base: Draft, edit: TaskEdit): Draft {
  const { customPropertyPatch, ...fields } = edit;
  const next = {
    ...base,
    ...Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, value ?? undefined]),
    ),
  };
  if (customPropertyPatch) {
    next.customProperties = { ...next.customProperties };
    for (const [key, value] of Object.entries(customPropertyPatch)) {
      if (value == null) delete next.customProperties[key];
      else next.customProperties[key] = value;
    }
  }
  return next;
}

export function editorPatch(base: Draft, patch: Partial<Draft>): TaskEdit {
  const { customProperties, ...fields } = patch;
  const edit: TaskEdit = Object.fromEntries(
    Object.entries(fields)
      .filter(([key, value]) => !same(base[key as keyof Draft], value))
      .map(([key, value]) => [key, value ?? null]),
  );
  if (customProperties) {
    const changes = Object.fromEntries(
      [
        ...new Set([
          ...Object.keys(base.customProperties),
          ...Object.keys(customProperties),
        ]),
      ]
        .filter(
          (key) => !same(base.customProperties[key], customProperties[key]),
        )
        .map((key) => [key, customProperties[key] ?? null]),
    );
    if (Object.keys(changes).length) edit.customPropertyPatch = changes;
  }
  return edit;
}

export interface StoredTaskEdit {
  readonly version: 1;
  readonly savedAt: string;
  /** Fields edited locally and still awaiting capture, confirmation or review. */
  readonly fields: TaskEdit;
}

export interface TaskEditStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = "tasknotes:unsaved-task-edit:v1";

/** Tab-only pairings retain drafts across a reconnect but never persist them. */
export function tabTaskEdits(): TaskEditStorage & { clear(): void } {
  const edits = new Map<string, string>();
  return {
    getItem: (key) => edits.get(key) ?? null,
    setItem: (key, value) => {
      edits.set(key, value);
    },
    removeItem: (key) => {
      edits.delete(key);
    },
    clear: () => edits.clear(),
  };
}

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
  if ((left ?? null) === (right ?? null)) return true;
  return (
    left != null &&
    right != null &&
    typeof left === "object" &&
    typeof right === "object" &&
    JSON.stringify(left) === JSON.stringify(right)
  );
}

/** False when this browser cannot keep the copy (storage full or blocked). */
export function writeTaskEdit(
  scope: string,
  taskId: string,
  fields: TaskEdit,
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
    ) {
      // Older copies contained the whole custom-properties object. Missing
      // keys carry no deletion intent and can belong to a newer peer edit.
      const { customProperties, customPropertyPatch, ...fields } =
        parsed.fields;
      stored = {
        version: 1,
        savedAt: parsed.savedAt ?? "",
        fields: {
          ...Object.fromEntries(
            Object.entries(fields).filter(([key]) =>
              Object.hasOwn(current, key),
            ),
          ),
          ...(customProperties || customPropertyPatch
            ? {
                customPropertyPatch: {
                  ...customProperties,
                  ...customPropertyPatch,
                },
              }
            : {}),
        },
      };
    }
  } catch {
    stored = null;
  }
  const fields = stored
    ? unconfirmed
      ? stored.fields
      : editorPatch(current, applyTaskEdit(current, stored.fields))
    : {};
  if (!stored || !Object.keys(fields).length) {
    clearTaskEdit(scope, taskId, storage);
    return null;
  }
  return { ...stored, fields };
}
