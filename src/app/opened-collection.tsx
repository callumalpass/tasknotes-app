import { useMemo } from "react";

import { AppShell } from "./app-shell";
import {
  CollectionGateContext,
  type CollectionChoice,
} from "./collection-context";
import { RepositoryProvider } from "./repository-context";

import type { TaskRepository } from "../storage/repository";

export function OpenedCollection({
  canChooseLocalFolder,
  choice,
  changeConnectedCollection,
  changeLocalCollection,
  choose,
  repository,
}: {
  canChooseLocalFolder: boolean;
  choice: CollectionChoice;
  changeConnectedCollection(): void;
  changeLocalCollection(): void;
  choose(choice: CollectionChoice): void;
  repository: TaskRepository;
}) {
  const value = useMemo(
    () => ({
      canChooseLocalFolder,
      choice,
      choose,
      changeConnectedCollection,
      changeLocalCollection,
    }),
    [
      canChooseLocalFolder,
      choice,
      choose,
      changeConnectedCollection,
      changeLocalCollection,
    ],
  );
  return (
    <CollectionGateContext.Provider value={value}>
      <RepositoryProvider
        reminderAuthority={choice === "cloud" ? "connect" : "device"}
        repository={repository}
      >
        <AppShell />
      </RepositoryProvider>
    </CollectionGateContext.Provider>
  );
}
