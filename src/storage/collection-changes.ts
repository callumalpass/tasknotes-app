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
    discovering: boolean;
  },
) {
  const tasks = new Map<string, wire.Change["kind"]>();
  // A full SDK changes page may end part-way through a replica version.
  let reset = batch.reset || batch.changes.length >= 1000;
  let model = false;
  let views = false;
  let data = false;
  for (const { id, kind, path, types, entity } of batch.changes) {
    const pathlessRemoval = kind === "remove" && path === "";
    if (
      !id ||
      (!path && !pathlessRemoval) ||
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
    const record = entity !== "file";
    views ||=
      path.endsWith(".base") ||
      path.startsWith("_views/") ||
      context.viewSources.has(id) ||
      (record && kind === "remove" && context.discovering) ||
      (record && kind === "put" && !types) ||
      !!types?.some((type) => context.viewTypes.has(type));
    data ||= record || pathlessRemoval;
    if (
      tasks.has(id) ||
      context.isKnownTask(id) ||
      (record &&
        (context.scanning ||
          (!pathlessRemoval && (!types || types.some(context.isTaskType)))))
    )
      tasks.set(id, kind);
  }
  return { reset, model, views, tasks, data };
}
