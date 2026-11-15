import { useEffect, useMemo, useRef } from "react";

import { IndexedDbMutationJournal } from "../storage/application-journal";

import { AppShell } from "./app-shell";
import {
  CollectionGateContext,
  type CollectionGateContextValue,
} from "./collection-context";
import { RepositoryProvider } from "./repository-context";

import type { TaskRepository } from "../application/ports/task-repository";
import type { ReminderAuthority } from "../native/notifications";

export function OpenedCollection({
  actions,
  discardPendingRecovery,
  reminderAuthority = "none",
  repository,
}: {
  actions: CollectionGateContextValue;
  discardPendingRecovery(): Promise<void>;
  /** "connect" when mdbase delivers this collection's reminders. */
  reminderAuthority?: ReminderAuthority;
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
        reminderAuthority={reminderAuthority}
        repository={repository}
      >
        <AppShell />
      </RepositoryProvider>
    </CollectionGateContext.Provider>
  );
}
