import type {
  TaskNotesAppSettingsChanges,
  TaskNotesAppSettingsValues,
} from "@tasknotes/model/settings";

import type {
  AppSettingsSnapshot,
  AppSettingsStore,
} from "./app-settings-store";

/** Why app settings are read-only when the collection has no settings type. */
export const TASKNOTES_SETTINGS_TYPE_MISSING_MESSAGE =
  "Templates, archiving, checklist resets, link format and timers stay read-only here until this collection's TaskNotes definitions are updated.";

/** Whether TaskNotes app settings can be saved to the settings record. */
export function appSettingsAccess(
  settingsType: boolean,
  snapshot: AppSettingsSnapshot<TaskNotesAppSettingsValues>,
): { writable: boolean; reason?: string } {
  // An rc.5 collection the pack upgrade has not reached: the record cannot be
  // created, and the moved settings are never written back to the binding.
  if (!settingsType)
    return { writable: false, reason: TASKNOTES_SETTINGS_TYPE_MISSING_MESSAGE };
  if (snapshot.settings.readOnly)
    return { writable: false, reason: snapshot.settings.readOnly };
  return { writable: true };
}

/** Save record changes, or throw the store's refusal. */
export async function saveAppSettings(
  store: AppSettingsStore<TaskNotesAppSettingsValues>,
  changes: TaskNotesAppSettingsChanges,
  prepared: AppSettingsSnapshot<TaskNotesAppSettingsValues>,
  signal?: AbortSignal,
): Promise<AppSettingsSnapshot<TaskNotesAppSettingsValues>> {
  const result = await store.save(changes, prepared, signal);
  if (!result.ok) throw new Error(result.message);
  return result.snapshot;
}
