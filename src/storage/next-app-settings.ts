import {
  MdbaseError,
  toPlain,
  type MdbaseClient,
  type PlainValue,
  type wire,
} from "@mdbase-dev/sdk";
import {
  tasknotesSettingsDefinition,
  type TaskNotesAppSettingsValues,
} from "@tasknotes/model/settings";

import {
  AppSettingsStore,
  type AppSettingsFailure,
  type AppSettingsRecord,
  type AppSettingsRecordPort,
} from "./app-settings-store";
import type { NextMutations } from "./next-mutations";

export type TaskNotesSettingsStore =
  AppSettingsStore<TaskNotesAppSettingsValues>;

/**
 * How native SDK failures read for a settings record: `not_found` is no
 * record; `forbidden` is a connection that may not change it; a revision
 * conflict or a taken path is a race with another writer.
 */
export function classifyNativeSettingsFailure(
  reason: unknown,
): AppSettingsFailure | undefined {
  if (!(reason instanceof MdbaseError)) return undefined;
  if (reason.code === "not_found") return "not_found";
  if (reason.code === "forbidden") return "read_only";
  if (
    reason.code === "conflict" &&
    (reason.reason === "revision" || reason.reason === "path_taken")
  )
    return "raced";
  return undefined;
}

/** The TaskNotes settings record over the native SDK client. Writes go
 * through the repository's confirmed mutation stream. */
export function nativeTaskNotesSettingsStore(
  client: MdbaseClient,
  mutations: NextMutations,
  owner: () => AbortSignal,
): TaskNotesSettingsStore {
  const read = async (path: string, signal?: AbortSignal) => {
    const record = await client.find({ path }, undefined, signal);
    return record ? settingsRecord(record) : null;
  };
  const readCreated = async (path: string, signal: AbortSignal) => {
    const record = await read(path, signal);
    if (!record) throw new Error("The saved settings record is not readable.");
    return record;
  };
  const port: AppSettingsRecordPort = {
    read,
    create: (input) =>
      mutations.run(
        {
          key: JSON.stringify(["settings:create", input]),
          prepare: async (mutationId, signal) => () =>
            client.create(
              {
                type: input.type,
                path: input.path,
                frontmatter: input.frontmatter as Record<string, PlainValue>,
                body: "",
              },
              { mutationId, signal },
            ),
          confirmed: (_receipt, signal) => readCreated(input.path, signal),
        },
        owner(),
      ),
    update: (input) =>
      mutations.run(
        {
          key: JSON.stringify(["settings:update", input]),
          prepare: async (mutationId, signal) => {
            const set: Record<string, PlainValue> = {};
            const unset: string[] = [];
            for (const [key, value] of Object.entries(input.patch)) {
              if (value === null) unset.push(key);
              else set[key] = value as PlainValue;
            }
            return () =>
              client.update(
                { path: input.path },
                {
                  patch: set,
                  ...(unset.length ? { unset } : {}),
                  ...(input.revision ? { ifRevision: input.revision } : {}),
                },
                { mutationId, signal },
              );
          },
          confirmed: (_receipt, signal) => readCreated(input.path, signal),
        },
        owner(),
      ),
    classify: classifyNativeSettingsFailure,
  };
  return new AppSettingsStore(port, tasknotesSettingsDefinition);
}

function settingsRecord(record: wire.RecordView): AppSettingsRecord {
  return {
    frontmatter: Object.fromEntries(
      [...record.frontmatter].map(([key, value]) => [key, toPlain(value)]),
    ),
    revision: record.revision,
  };
}
