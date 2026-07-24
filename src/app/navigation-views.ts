import type { CollectionInfo } from "../storage/repository";

const STORAGE_KEY = "tasknotes:navigation-views:v2";
const LEGACY_STORAGE_KEY = "tasknotes:primary-views:v1";

export function navigationViewScope(info: CollectionInfo): string {
  return `${info.kind}:${info.id ?? info.location}`;
}

export function readNavigationViewKeys(
  storage: Pick<Storage, "getItem">,
  scope: string,
): string[] | undefined {
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const keys = (value as Record<string, unknown>)[scope];
      if (Array.isArray(keys))
        return unique(
          keys.filter(
            (candidate): candidate is string =>
              typeof candidate === "string" && Boolean(candidate),
          ),
        );
    }
    const legacy = JSON.parse(
      storage.getItem(LEGACY_STORAGE_KEY) ?? "{}",
    ) as unknown;
    if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) return;
    const key = (legacy as Record<string, unknown>)[scope];
    return typeof key === "string" && key ? [key] : undefined;
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
    // Replace malformed device-local preferences with a valid record.
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
