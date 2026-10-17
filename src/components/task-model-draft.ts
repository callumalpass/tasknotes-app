import { useCallback, useSyncExternalStore } from "react";

import type { TaskCollectionConfiguration } from "../domain/task-configuration";

export interface TaskModelSettingsDraft {
  defaultStatus: string;
  defaultPriority: string;
  maintainDueDateOffset: boolean;
  resetCheckboxesOnRecurrence: boolean;
  defaultMaterialization: "manual" | "on_completion" | "rolling";
  defaultNextTrigger: "completion" | "completion_or_skip";
  pastHorizon: string;
  futureHorizon: string;
  autoStopOnComplete: boolean;
  writeFormat: "wikilink" | "markdown";
  moveOnArchive: boolean;
  archiveFolder: string;
  templatingEnabled: boolean;
  templatePath: string;
  statusAutomation: Record<
    string,
    { autoArchive: boolean; autoArchiveDelay: number }
  >;
}

type DraftPatch = Partial<TaskModelSettingsDraft>;

// Unsaved collection settings outlive the editor so leaving Settings, or
// switching sections on a phone, never discards them. Keyed by repository so a
// draft never follows the user into another collection.
const patches = new WeakMap<object, DraftPatch>();
const listeners = new Set<() => void>();
const EMPTY: DraftPatch = {};

function publish() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Returns the editable draft over the collection's current settings. Only
 * fields that differ from the collection are retained, so a change made
 * elsewhere to an untouched field is still reflected here.
 */
export function useTaskModelDraft(
  repository: object,
  configuration: TaskCollectionConfiguration,
) {
  const patch = useSyncExternalStore(
    subscribe,
    () => patches.get(repository) ?? EMPTY,
  );
  const original = settingsDraft(configuration);
  const draft = { ...original, ...patch };
  const dirty = changedKeys(draft, original).length > 0;

  const change = useCallback(
    (next: DraftPatch) => {
      const base = settingsDraft(configuration);
      const merged = { ...base, ...(patches.get(repository) ?? {}), ...next };
      const retained = Object.fromEntries(
        changedKeys(merged, base).map((key) => [key, merged[key]]),
      ) as DraftPatch;
      if (Object.keys(retained).length) patches.set(repository, retained);
      else patches.delete(repository);
      publish();
    },
    [configuration, repository],
  );

  const discard = useCallback(() => {
    patches.delete(repository);
    publish();
  }, [repository]);

  return { draft, original, dirty, change, discard };
}

export function useUnsavedTaskModelDraft(repository: object): boolean {
  return useSyncExternalStore(
    subscribe,
    () => Object.keys(patches.get(repository) ?? EMPTY).length > 0,
  );
}

function changedKeys(
  draft: TaskModelSettingsDraft,
  original: TaskModelSettingsDraft,
): (keyof TaskModelSettingsDraft)[] {
  return (Object.keys(draft) as (keyof TaskModelSettingsDraft)[]).filter(
    (key) => JSON.stringify(draft[key]) !== JSON.stringify(original[key]),
  );
}

export function settingsDraft(
  configuration: TaskCollectionConfiguration,
): TaskModelSettingsDraft {
  return {
    defaultStatus: configuration.defaults.status,
    defaultPriority: configuration.defaults.priority,
    maintainDueDateOffset: configuration.recurrence.maintainDueDateOffset,
    resetCheckboxesOnRecurrence:
      configuration.recurrence.resetCheckboxesOnRecurrence,
    defaultMaterialization: configuration.occurrences.defaultMaterialization,
    defaultNextTrigger: configuration.occurrences.defaultNextTrigger,
    pastHorizon: configuration.occurrences.pastHorizon ?? "P0D",
    futureHorizon: configuration.occurrences.futureHorizon ?? "P14D",
    autoStopOnComplete: configuration.timeTracking.autoStopOnComplete,
    writeFormat: configuration.linkWriteFormat,
    moveOnArchive: configuration.archive.moveOnArchive,
    archiveFolder: configuration.archive.folder,
    templatingEnabled: configuration.templating.enabled,
    templatePath: configuration.templating.templatePath ?? "",
    statusAutomation: Object.fromEntries(
      configuration.statuses.map((status) => [
        status.value,
        {
          autoArchive: status.autoArchive,
          autoArchiveDelay: status.autoArchiveDelay,
        },
      ]),
    ),
  };
}
