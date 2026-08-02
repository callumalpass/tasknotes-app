import { useEffect, useMemo } from "react";

import { IndexedDbMutationJournal } from "../storage/application-journal";

import { AppShell } from "./app-shell";
import {
  CollectionGateContext,
  type CollectionChoice,
} from "./collection-context";
import { RepositoryProvider } from "./repository-context";

import type { TaskRepository } from "../application/ports/task-repository";

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
  const mutationJournal = useMemo(() => new IndexedDbMutationJournal(), []);
  useEffect(
    () => () => {
      mutationJournal.close();
    },
    [mutationJournal],
  );
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
        mutationJournal={mutationJournal}
        reminderAuthority={choice === "cloud" ? "connect" : "none"}
        repository={repository}
      >
        <AppShell />
      </RepositoryProvider>
    </CollectionGateContext.Provider>
  );
}
