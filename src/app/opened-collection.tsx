import { useEffect, useMemo } from "react";

import { IndexedDbMutationJournal } from "../storage/application-journal";

import { AppShell } from "./app-shell";
import { CollectionGateContext } from "./collection-context";
import { RepositoryProvider } from "./repository-context";

import type { TaskRepository } from "../application/ports/task-repository";

export function OpenedCollection({
  authorizeAnotherCollection,
  changeCollection,
  discardPendingRecovery,
  reauthorizeCurrentCollection,
  repository,
}: {
  authorizeAnotherCollection(): void;
  changeCollection(): void;
  discardPendingRecovery(): Promise<void>;
  reauthorizeCurrentCollection(): void;
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
      authorizeAnotherCollection,
      changeCollection,
      reauthorizeCurrentCollection,
    }),
    [
      authorizeAnotherCollection,
      changeCollection,
      reauthorizeCurrentCollection,
    ],
  );
  return (
    <CollectionGateContext.Provider value={value}>
      <RepositoryProvider
        mutationJournal={mutationJournal}
        discardPendingRecovery={discardPendingRecovery}
        reminderAuthority="connect"
        repository={repository}
      >
        <AppShell />
      </RepositoryProvider>
    </CollectionGateContext.Provider>
  );
}
