import { createContext, useContext } from "react";

export type CollectionChoice = "local" | "cloud";

export interface CollectionGateContextValue {
  canChooseLocalFolder: boolean;
  choice: CollectionChoice;
  choose(choice: CollectionChoice): void;
  authorizeAnotherCloudCollection(): void;
  changeConnectedCollection(): void;
  changeLocalCollection(): void;
  reauthorizeCurrentCloudCollection(): void;
}

export const CollectionGateContext =
  createContext<CollectionGateContextValue | null>(null);

export function useCollectionGate(): CollectionGateContextValue {
  const value = useContext(CollectionGateContext);
  if (!value) throw new Error("Collection settings are unavailable.");
  return value;
}
