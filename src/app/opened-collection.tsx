import { useEffect, useMemo, useRef } from "react";

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
  const journalLifetime = useRef({ mounts: 0 });
  useEffect(() => {
    const lifetime = journalLifetime.current;
    lifetime.mounts += 1;
    return () => {
      lifetime.mounts -= 1;
      // Effect replay keeps this bounded application journal; real unmount
      // closes it. Collection data still belongs solely to the repository.
      queueMicrotask(() => {
        if (!lifetime.mounts) mutationJournal.close();
      });
    };
  }, [mutationJournal]);
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
