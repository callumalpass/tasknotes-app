import { createContext, useContext } from "react";

export interface CollectionGateContextValue {
  authorizeAnotherCollection(): void;
  changeCollection(): void;
  reauthorizeCurrentCollection(): void;
}

export const CollectionGateContext =
  createContext<CollectionGateContextValue | null>(null);

export function useCollectionGate(): CollectionGateContextValue {
  const value = useContext(CollectionGateContext);
  if (!value) throw new Error("Collection settings are unavailable.");
  return value;
}
