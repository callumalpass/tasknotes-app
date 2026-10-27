import type { JsonObject, MdbaseConnection } from "@mdbase-dev/connect";
import {
  tasknotesSettingsDefinition,
  type TaskNotesAppSettingsValues,
} from "@tasknotes/model/settings";

import { connectProblemFromError } from "../cloud/outcome";
import {
  AppSettingsStore,
  type AppSettingsFailure,
  type AppSettingsRecord,
} from "./app-settings-store";
import { validResult } from "./mdbase-operation";

/**
 * How Connect problems read for a settings record, as in mdbase Reader:
 * `file_not_found` is no record; `not_authorized` and `access_denied` are a
 * connection that may not change it; `concurrent_modification` and
 * `path_taken` are a race with another writer.
 */
export function classifyConnectSettingsFailure(
  reason: unknown,
): AppSettingsFailure | undefined {
  const code = connectProblemFromError(reason)?.code;
  if (code === "file_not_found") return "not_found";
  if (code === "not_authorized" || code === "access_denied") return "read_only";
  if (code === "concurrent_modification" || code === "path_taken")
    return "raced";
  return undefined;
}

/** The TaskNotes settings record over a Connect connection. */
export function connectTaskNotesSettingsStore(
  connect: MdbaseConnection<JsonObject>,
  request: () => { signal: AbortSignal },
): AppSettingsStore<TaskNotesAppSettingsValues> {
  const record = (value: {
    frontmatter?: JsonObject;
    revision?: string;
  }): AppSettingsRecord => ({
    frontmatter: value.frontmatter ?? {},
    ...(value.revision ? { revision: value.revision } : {}),
  });
  return new AppSettingsStore(
    {
      read: async (path) =>
        record(validResult(await connect.read({ path }, request()))),
      create: async (input) =>
        record(
          validResult(
            await connect.create(
              {
                path: input.path,
                type: input.type,
                frontmatter: input.frontmatter as JsonObject,
                body: "",
              },
              request(),
            ),
          ),
        ),
      update: async (input) =>
        record(
          validResult(
            await connect.update(
              {
                path: input.path,
                patch: input.patch as JsonObject,
                ...(input.revision ? { ifRevision: input.revision } : {}),
              },
              request(),
            ),
          ),
        ),
      classify: classifyConnectSettingsFailure,
    },
    tasknotesSettingsDefinition,
  );
}
