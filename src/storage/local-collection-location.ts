import { Capacitor } from "@capacitor/core";

import {
  FolderAccess,
  type NativeFolderSelection,
} from "../native/folder-access";

const STORAGE_KEY = "tasknotes:local-collection-location:v1";

export type LocalCollectionLocation =
  | { mode: "default" }
  | {
      mode: "external";
      id: string;
      name: string;
    };

export function readLocalCollectionLocation(
  storage: Pick<Storage, "getItem"> = localStorage,
): LocalCollectionLocation {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null") as {
      mode?: unknown;
      id?: unknown;
      name?: unknown;
    } | null;
    if (
      parsed?.mode === "external" &&
      typeof parsed.id === "string" &&
      parsed.id &&
      typeof parsed.name === "string" &&
      parsed.name
    )
      return { mode: "external", id: parsed.id, name: parsed.name };
  } catch {
    // A malformed preference falls back to TaskNotes' ordinary folder.
  }
  return { mode: "default" };
}

export async function chooseExistingLocalCollection(): Promise<
  LocalCollectionLocation | undefined
> {
  if (!Capacitor.isNativePlatform())
    throw new Error("Folder selection is available in the mobile app.");
  const result = await FolderAccess.pickFolder();
  if (result.cancelled || !result.selection) return;
  const location = fromNativeSelection(result.selection);
  saveLocalCollectionLocation(location);
  return location;
}

export async function chooseDefaultLocalCollection(): Promise<LocalCollectionLocation> {
  const current = readLocalCollectionLocation();
  if (current.mode === "external" && Capacitor.isNativePlatform())
    await FolderAccess.clearFolder({ selectionId: current.id }).catch(
      () => undefined,
    );
  const location = { mode: "default" } as const;
  saveLocalCollectionLocation(location);
  return location;
}

export function localCollectionKey(location: LocalCollectionLocation): string {
  return location.mode === "external" ? location.id : "default";
}

function fromNativeSelection(
  selection: NativeFolderSelection,
): LocalCollectionLocation {
  return {
    mode: "external",
    id: selection.id,
    name: selection.name,
  };
}

function saveLocalCollectionLocation(
  location: LocalCollectionLocation,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(location));
}
