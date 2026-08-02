import {
  isTaskNotesDefaultViewDocument,
  taskNotesDefaultBaseDocument,
  taskNotesDefaultCanonicalDocument,
  TASKNOTES_DEFAULT_VIEW_SOURCE_NAME,
} from "../domain/default-view-source";

import type { TaskRepository } from "./ports/task-repository";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type { TaskViewDocument } from "../domain/view";

export async function ensureTaskNotesDefaultViewSource(
  repository: TaskRepository,
  documents: TaskViewDocument[],
  configuration: TaskCollectionConfiguration,
): Promise<TaskViewDocument[]> {
  const existing = documents.find(isTaskNotesDefaultViewDocument);
  if (existing) return documents;

  try {
    await repository.createViewSource({
      format: "obsidian.base",
      name: TASKNOTES_DEFAULT_VIEW_SOURCE_NAME,
      document: taskNotesDefaultBaseDocument(configuration),
    });
  } catch (baseError) {
    const concurrent = await repository.listViews();
    if (concurrent.some(isTaskNotesDefaultViewDocument)) return concurrent;
    if (concurrent.length) return concurrent;
    const sync = await repository.syncStatus();
    if (sync.mode !== "replicated") throw baseError;
    await repository.createViewSource({
      format: "mdbase.view",
      name: TASKNOTES_DEFAULT_VIEW_SOURCE_NAME,
      document: taskNotesDefaultCanonicalDocument(configuration),
    });
  }
  return repository.listViews();
}
