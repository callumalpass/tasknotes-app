import { useMemo } from "react";

import { AppShell } from "./app-shell";
import {
  CollectionGateContext,
  type CollectionChoice,
} from "./collection-context";
import { RepositoryProvider } from "./repository-context";

import type { TaskRepository } from "../storage/repository";

export function OpenedCollection({
  choice,
  changeConnectedCollection,
  choose,
  repository,
}: {
  choice: CollectionChoice;
  changeConnectedCollection(): void;
  choose(choice: CollectionChoice): void;
  repository: TaskRepository;
}) {
  const value = useMemo(
    () => ({ choice, choose, changeConnectedCollection }),
    [choice, choose, changeConnectedCollection],
  );
  return (
    <CollectionGateContext.Provider value={value}>
      <RepositoryProvider repository={repository}>
        <AppShell />
      </RepositoryProvider>
    </CollectionGateContext.Provider>
  );
}
