import {
  TASKNOTES_DEFAULT_VIEW_SOURCES,
  taskNotesDefaultBaseSources,
} from "../domain/default-view-source";

import type { TaskRepository } from "./ports/task-repository";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type { TaskViewDocument } from "../domain/view";

export async function ensureTaskNotesDefaultViewSource(
  repository: TaskRepository,
  documents: TaskViewDocument[],
  configuration: TaskCollectionConfiguration,
): Promise<TaskViewDocument[]> {
  if (repository.defaultViewSourceCreation === "explicit-only")
    return documents;
  return createMissingStarterSources(repository, documents, configuration);
}

/** Explicit starter-view creation. Call only from a user action (Add starter
 * views) or right after the person completed collection setup or approval;
 * never from navigation, discovery or render.
 *
 * `onlyIfNoViews` is for the post-setup moment: a collection that already has
 * any view source is left alone, so deleted starters are never recreated.
 * Repeating it is a no-op, and a concurrent tab's create is adopted by
 * re-listing instead of failing.
 */
export async function addTaskNotesStarterViews(
  repository: TaskRepository,
  configuration: TaskCollectionConfiguration,
  options: { onlyIfNoViews?: boolean } = {},
): Promise<TaskViewDocument[]> {
  const documents = await repository.listViews();
  if (options.onlyIfNoViews && documents.length) return documents;
  return createMissingStarterSources(repository, documents, configuration);
}

export function hasTaskNotesStarterViews(
  documents: readonly TaskViewDocument[],
): boolean {
  return TASKNOTES_DEFAULT_VIEW_SOURCES.some((source) =>
    hasSource(documents, source.path),
  );
}

async function createMissingStarterSources(
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
