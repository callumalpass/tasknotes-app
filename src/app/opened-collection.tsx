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
  choose,
  disconnectCloud,
  repository,
}: {
  choice: CollectionChoice;
  choose(choice: CollectionChoice): void;
  disconnectCloud(): void;
  repository: TaskRepository;
}) {
  const value = useMemo(
    () => ({ choice, choose, disconnectCloud }),
    [choice, choose, disconnectCloud],
  );
  return (
    <CollectionGateContext.Provider value={value}>
      <RepositoryProvider repository={repository}>
        <AppShell />
      </RepositoryProvider>
    </CollectionGateContext.Provider>
  );
}
