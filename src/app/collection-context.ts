import { createContext, useContext } from "react";
import type { CollectionUiOptions } from "@mdbase-dev/ui/collections";

export interface CollectionGateContextValue {
  /** The shared collection UI's options; null outside mdbase (the demo). */
  collectionUi: CollectionUiOptions | null;
  /** Close this collection and show the list. */
  changeCollection(): void;
  /** Review this collection's access again (opens Connect; call from the click). */
  reauthorizeCurrentCollection(): void;
}

export const CollectionGateContext =
  createContext<CollectionGateContextValue | null>(null);

export function useCollectionGate(): CollectionGateContextValue {
  const value = useContext(CollectionGateContext);
  if (!value) throw new Error("Collection settings are unavailable.");
  return value;
}
