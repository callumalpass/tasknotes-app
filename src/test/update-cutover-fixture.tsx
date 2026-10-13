import { useMemo } from "react";
import { AppShell } from "../app/app-shell";
import { CollectionGateContext } from "../app/collection-context";
import { RepositoryProvider } from "../app/repository-context";
import { DemoMutationJournal } from "../demo/demo-mutation-journal";
import { DemoTaskRepository } from "../demo/demo-task-repository";
import type { UpdateTaskInput } from "../domain/task";

// Loopback-only test authority survives a real document reload; it is not a task replica.
class CutoverRepository extends DemoTaskRepository {
  async initialize() {
    await super.initialize();
    const response = await fetch("/__cutover/task", { cache: "no-store" });
    if (!response.ok) throw new Error("Cutover fixture could not load.");
    const input = (await response.json()) as UpdateTaskInput | null;
    if (input) await super.update("demo-planning-session", input);
  }
  async update(id: string, input: UpdateTaskInput) {
    const response = await fetch("/__cutover/task", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error("Cutover fixture refused the save.");
    return super.update(id, input);
  }
}

export function UpdateCutoverFixture() {
  if (import.meta.env.MODE !== "e2e" || location.hostname !== "127.0.0.1")
    throw new Error("Cutover fixtures require a loopback e2e build.");
  const repository = useMemo(() => new CutoverRepository(1), []);
  const mutationJournal = useMemo(() => new DemoMutationJournal(), []);
  return (
    <CollectionGateContext.Provider
      value={{
        collectionUi: null,
        changeCollection() {},
        reauthorizeCurrentCollection() {},
      }}
    >
      <RepositoryProvider
        repository={repository}
        mutationJournal={mutationJournal}
        reminderAuthority="none"
      >
        <AppShell />
      </RepositoryProvider>
    </CollectionGateContext.Provider>
  );
}
