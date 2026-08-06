import type { CollectionInfo } from "../application/ports/task-repository";

const STORAGE_KEY = "tasknotes:navigation-views:v4";
const PREVIOUS_STORAGE_KEYS = [
  "tasknotes:navigation-views:v3",
  "tasknotes:navigation-views:v2",
];
const LEGACY_STORAGE_KEY = "tasknotes:primary-views:v1";
export const SCRATCHPAD_NAVIGATION_KEY = "tasknotes:scratchpad";
export const SEARCH_NAVIGATION_KEY = "tasknotes:search";

export function isSpecialNavigationKey(key: string): boolean {
  return key === SCRATCHPAD_NAVIGATION_KEY || key === SEARCH_NAVIGATION_KEY;
}

export function navigationViewScope(info: CollectionInfo): string {
  return `${info.kind}:${info.id ?? info.location}`;
}

export function readNavigationViewKeys(
  storage: Pick<Storage, "getItem">,
  scope: string,
): string[] | undefined {
  return readScopedKeys(storage, STORAGE_KEY, scope);
}

export function readPreviousNavigationViewKeys(
  storage: Pick<Storage, "getItem">,
  scope: string,
): string[] | undefined {
  for (const key of PREVIOUS_STORAGE_KEYS) {
    const stored = readScopedKeys(storage, key, scope);
    if (stored) return stored;
  }
  return;
}

export function readLegacyPrimaryViewKey(
  storage: Pick<Storage, "getItem">,
  scope: string,
): string | undefined {
  try {
    const value = JSON.parse(
      storage.getItem(LEGACY_STORAGE_KEY) ?? "{}",
    ) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const key = (value as Record<string, unknown>)[scope];
    return typeof key === "string" && key ? key : undefined;
  } catch {
    return;
  }
}

export function writeNavigationViewKeys(
  storage: Pick<Storage, "getItem" | "setItem">,
  scope: string,
  keys: readonly string[],
): void {
  let values: Record<string, string[]> = {};
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      values = Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string[]] =>
            Array.isArray(entry[1]) &&
            entry[1].every((candidate) => typeof candidate === "string"),
        ),
      );
  } catch {
    // Replace malformed browser preferences with a valid record.
  }
  values[scope] = unique(keys);
  storage.setItem(STORAGE_KEY, JSON.stringify(values));
}

export function moveNavigationViewKey(
  keys: readonly string[],
  key: string,
  direction: -1 | 1,
): string[] {
  const next = [...keys];
  const index = next.indexOf(key);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= next.length) return next;
  [next[index], next[destination]] = [next[destination], next[index]];
  return next;
}

function unique(keys: readonly string[]): string[] {
  return [...new Set(keys)];
}

function readScopedKeys(
  storage: Pick<Storage, "getItem">,
  key: string,
  scope: string,
): string[] | undefined {
  try {
    const value = JSON.parse(storage.getItem(key) ?? "{}") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const keys = (value as Record<string, unknown>)[scope];
    return Array.isArray(keys)
      ? unique(
          keys.filter(
            (candidate): candidate is string =>
              typeof candidate === "string" && Boolean(candidate),
          ),
        )
      : undefined;
  } catch {
    return;
  }
}
