import { useEffect, useMemo, useRef } from "react";

import { IndexedDbMutationJournal } from "../storage/application-journal";

import { AppShell } from "./app-shell";
import {
  CollectionGateContext,
  type CollectionGateContextValue,
} from "./collection-context";
import { RepositoryProvider } from "./repository-context";

import type { TaskRepository } from "../application/ports/task-repository";

export function OpenedCollection({
  actions,
  discardPendingRecovery,
  repository,
}: {
  actions: CollectionGateContextValue;
  discardPendingRecovery(): Promise<void>;
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
  return (
    <CollectionGateContext.Provider value={actions}>
      <RepositoryProvider
        mutationJournal={mutationJournal}
        discardPendingRecovery={discardPendingRecovery}
        reminderAuthority="none"
        repository={repository}
      >
        <AppShell />
      </RepositoryProvider>
    </CollectionGateContext.Provider>
  );
}
