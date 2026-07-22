import type { CollectionInfo } from "../storage/repository";

const STORAGE_KEY = "tasknotes:primary-views:v1";

export function primaryViewScope(info: CollectionInfo): string {
  return `${info.kind}:${info.location}`;
}

export function readPrimaryViewKey(
  storage: Pick<Storage, "getItem">,
  scope: string,
): string | undefined {
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const key = (value as Record<string, unknown>)[scope];
    return typeof key === "string" && key ? key : undefined;
  } catch {
    return;
  }
}

export function writePrimaryViewKey(
  storage: Pick<Storage, "getItem" | "setItem">,
  scope: string,
  key?: string,
): void {
  let values: Record<string, string> = {};
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      values = Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
  } catch {
    // Replace malformed device-local preferences with a valid record.
  }
  if (key) values[scope] = key;
  else delete values[scope];
  storage.setItem(STORAGE_KEY, JSON.stringify(values));
}
