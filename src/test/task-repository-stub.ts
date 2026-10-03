import type { TaskRepository } from "../application/ports/task-repository";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";

async function unconfigured(): Promise<never> {
  throw new Error("Unconfigured TaskRepository operation in test.");
}

/** Typed overrides, not a second fake engine. Optional capabilities remain absent. */
export function taskRepositoryStub(
  overrides: Partial<TaskRepository>,
  scanned = 0,
): TaskRepository {
  return {
    initialize: async () => undefined,
    refresh: async () => ({ scanned, changed: 0, removed: 0, elapsedMs: 0 }),
    taskConfiguration: async () => defaultTaskCollectionConfiguration(),
    connectionStatus: async () => ({ state: "connected" }),
    subscribe: () => () => undefined,
    listSummaries: unconfigured,
    search: unconfigured,
    list: unconfigured,
    getSummary: unconfigured,
    get: unconfigured,
    relationships: unconfigured,
    completeField: unconfigured,
    create: unconfigured,
    update: unconfigured,
    updateMany: unconfigured,
    toggle: unconfigured,
    skip: unconfigured,
    materializeOccurrence: unconfigured,
    startTimeTracking: unconfigured,
    stopTimeTracking: unconfigured,
    replaceTimeEntries: unconfigured,
    removeTimeEntry: unconfigured,
    setArchived: unconfigured,
    delete: unconfigured,
    stats: unconfigured,
    cachedViews: unconfigured,
    listViews: unconfigured,
    cachedViewExecution: unconfigured,
    executeView: unconfigured,
    readViewSource: unconfigured,
    createViewSource: unconfigured,
    updateViewSource: unconfigured,
    deleteViewSource: unconfigured,
    taskModelSettingsAccess: unconfigured,
    updateTaskModelSettings: unconfigured,
    collectionInfo: unconfigured,
    ...overrides,
  };
}
