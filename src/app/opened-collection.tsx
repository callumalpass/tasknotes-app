import { useMemo } from "react";

import { AppShell } from "./app-shell";
import {
  CollectionGateContext,
  type CollectionChoice,
} from "./collection-context";
import { RepositoryProvider } from "./repository-context";

import type { TaskRepository } from "../storage/repository";

export function OpenedCollection({
  authorizeAnotherCloudCollection,
  canChooseLocalFolder,
  choice,
  changeConnectedCollection,
  changeLocalCollection,
  choose,
  reauthorizeCurrentCloudCollection,
  repository,
}: {
  authorizeAnotherCloudCollection(): void;
  canChooseLocalFolder: boolean;
  choice: CollectionChoice;
  changeConnectedCollection(): void;
  changeLocalCollection(): void;
  choose(choice: CollectionChoice): void;
  reauthorizeCurrentCloudCollection(): void;
  repository: TaskRepository;
}) {
  const value = useMemo(
    () => ({
      authorizeAnotherCloudCollection,
      canChooseLocalFolder,
      choice,
      choose,
      changeConnectedCollection,
      changeLocalCollection,
      reauthorizeCurrentCloudCollection,
    }),
    [
      authorizeAnotherCloudCollection,
      canChooseLocalFolder,
      choice,
      choose,
      changeConnectedCollection,
      changeLocalCollection,
      reauthorizeCurrentCloudCollection,
    ],
  );
  return (
    <CollectionGateContext.Provider value={value}>
      <RepositoryProvider
        reminderAuthority={choice === "cloud" ? "connect" : "none"}
        repository={repository}
      >
        <AppShell />
      </RepositoryProvider>
    </CollectionGateContext.Provider>
  );
}
