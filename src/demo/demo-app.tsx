import { useMemo } from "react";

import { AppShell } from "../app/app-shell";
import { CollectionGateContext } from "../app/collection-context";
import { RepositoryProvider } from "../app/repository-context";
import { DemoMutationJournal } from "./demo-mutation-journal";
import { DemoTaskRepository } from "./demo-task-repository";

export function DemoApp({
  count,
  adjustDefinition,
}: {
  count: number;
  adjustDefinition?: ConstructorParameters<typeof DemoTaskRepository>[1];
}) {
  const repository = useMemo(
    () => new DemoTaskRepository(count, adjustDefinition),
    [adjustDefinition, count],
  );
  const mutationJournal = useMemo(() => new DemoMutationJournal(), []);
  const collectionActions = useMemo(
    () => ({
      collectionUi: null,
      changeCollection: exitDemo,
      reauthorizeCurrentCollection: exitDemo,
    }),
    [],
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

function exitDemo(): void {
  const url = new URL(location.href);
  url.pathname = import.meta.env.BASE_URL;
  url.searchParams.delete("demo");
  url.searchParams.delete("occurrence");
  location.assign(`${url.pathname}${url.search}${url.hash}`);
}
