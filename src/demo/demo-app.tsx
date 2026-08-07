import { useMemo } from "react";

import { AppShell } from "../app/app-shell";
import { CollectionGateContext } from "../app/collection-context";
import { RepositoryProvider } from "../app/repository-context";
import { DemoMutationJournal } from "./demo-mutation-journal";
import { DemoTaskRepository } from "./demo-task-repository";

export function DemoApp({
  count,
  embedded = false,
}: {
  count: number;
  embedded?: boolean;
}) {
  const repository = useMemo(() => new DemoTaskRepository(count), [count]);
  const mutationJournal = useMemo(() => new DemoMutationJournal(), []);
  const collectionActions = useMemo(
    () => ({
      authorizeAnotherCollection: () => exitDemo(embedded),
      changeCollection: () => exitDemo(embedded),
      reauthorizeCurrentCollection: () => exitDemo(embedded),
    }),
    [embedded],
  );

  return (
    <CollectionGateContext.Provider value={collectionActions}>
      <RepositoryProvider
        mutationJournal={mutationJournal}
        reminderAuthority="none"
        repository={repository}
      >
        <AppShell />
      </RepositoryProvider>
    </CollectionGateContext.Provider>
  );
}

function exitDemo(embedded: boolean): void {
  const url = new URL(location.href);
  url.pathname = import.meta.env.BASE_URL;
  url.searchParams.delete("demo");
  url.searchParams.delete("occurrence");
  if (embedded) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  location.assign(`${url.pathname}${url.search}${url.hash}`);
}
