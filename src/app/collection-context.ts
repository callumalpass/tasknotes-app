import { createContext, useContext } from "react";

export type CollectionChoice = "local" | "cloud";

export interface CollectionGateContextValue {
  choice: CollectionChoice;
  choose(choice: CollectionChoice): void;
  disconnectCloud(): void;
}

export const CollectionGateContext =
  createContext<CollectionGateContextValue | null>(null);

export function useCollectionGate(): CollectionGateContextValue {
  const value = useContext(CollectionGateContext);
  if (!value) throw new Error("Collection settings are unavailable.");
  return value;
}
