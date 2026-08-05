import { taskNotesDefaultBaseSources } from "../domain/default-view-source";

import type { TaskRepository } from "./ports/task-repository";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type { TaskViewDocument } from "../domain/view";

export async function ensureTaskNotesDefaultViewSource(
  repository: TaskRepository,
  documents: TaskViewDocument[],
  configuration: TaskCollectionConfiguration,
): Promise<TaskViewDocument[]> {
  const sources = taskNotesDefaultBaseSources(configuration);
  if (sources.every((source) => hasSource(documents, source.path))) {
    return documents;
  }
  let current = documents;
  for (const source of sources) {
    if (hasSource(current, source.path)) continue;
    try {
      await repository.createViewSource({
        path: source.path,
        format: "obsidian.base",
        name: source.name,
        document: source.document,
      });
    } catch (reason) {
      const concurrent = await repository.listViews();
      if (!hasSource(concurrent, source.path)) throw reason;
      current = concurrent;
    }
  }
  return repository.listViews();
}

function hasSource(
  documents: readonly TaskViewDocument[],
  path: string,
): boolean {
  return documents.some(
    (document) => document.source.path.toLowerCase() === path.toLowerCase(),
  );
}
