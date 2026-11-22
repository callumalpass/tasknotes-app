import { useMemo } from "react";

import { AppShell } from "../app/app-shell";
import { CollectionGateContext } from "../app/collection-context";
import { RepositoryProvider } from "../app/repository-context";
import { DemoMutationJournal } from "./demo-mutation-journal";
import type { DemoSeed } from "./demo-seed";
import { DemoTaskRepository } from "./demo-task-repository";

export function DemoApp({
  count,
  adjustDefinition,
  seed,
}: {
  count: number;
  adjustDefinition?: ConstructorParameters<typeof DemoTaskRepository>[1];
  seed?: DemoSeed;
}) {
  const repository = useMemo(
    () => new DemoTaskRepository(count, adjustDefinition, seed),
    [adjustDefinition, count, seed],
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
