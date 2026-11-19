import type { wire } from "@mdbase-dev/sdk";
import {
  appSettingsPath,
  legacyAppSettingsPath,
  tasknotesSettingsDefinition,
} from "@tasknotes/model/settings";

const settingsPaths = new Set([
  appSettingsPath(tasknotesSettingsDefinition.app),
  legacyAppSettingsPath(tasknotesSettingsDefinition.app),
]);

export function classifyChangeBatch(
  batch: wire.ChangesResult,
  context: {
    settingsId?: string;
    isTaskType(name: string): boolean;
    isKnownTask(id: string): boolean;
    viewTypes: ReadonlySet<string>;
    viewSources: ReadonlySet<string>;
    scanning: boolean;
  },
) {
  const tasks = new Map<string, wire.Change["kind"]>();
  // A full SDK changes page may end part-way through a replica version.
  let reset = batch.reset || batch.changes.length >= 1000;
  let model = false;
  let views = false;
  let data = false;
  for (const { id, kind, path, types, entity } of batch.changes) {
    if (
      !id ||
      !path ||
      (kind !== "put" && kind !== "remove") ||
      (entity !== undefined && entity !== "record" && entity !== "file")
    ) {
      reset = true;
      continue;
    }
    model ||=
      id === context.settingsId ||
      settingsPaths.has(path) ||
      /^_(types|contracts|schemas)\//.test(path);
    views ||=
      path.endsWith(".base") ||
      path.startsWith("_views/") ||
      context.viewSources.has(id) ||
      !!types?.some((type) => context.viewTypes.has(type));
    const record = entity !== "file";
    data ||= record;
    if (
      tasks.has(id) ||
      context.isKnownTask(id) ||
      (record && (context.scanning || !types || types.some(context.isTaskType)))
    )
      tasks.set(id, kind);
  }
  return { reset, model, views, tasks, data };
}
