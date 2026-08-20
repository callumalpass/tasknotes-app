import { MDBASE_TIMER_FIRED_CONTRACT } from "@mdbase-dev/connect-protocol";
import {
  loadCanonicalTaskNotesTypePack,
  TASKNOTES_APP_TYPE_PACK_VERSION,
} from "./canonical-task-pack.mjs";
import { buildScratchpadTypePack } from "./scratchpad-type.mjs";

export { TASKNOTES_APP_TYPE_PACK_VERSION } from "./canonical-task-pack.mjs";

export async function buildTaskNotesManifest({
  appUrl,
  webOnly,
  firebaseProjectId,
}) {
  // Keep the application identity and callback on the same origin. Local
  // manifests are accepted only by development validation; external local
  // authorization should use a public tunnel and TASKNOTES_APP_URL.
  const identityUrl = appUrl;
  const typePack = await loadCanonicalTaskNotesTypePack();
  const taskContract = typePack.provides.find(
    (contract) => contract.id === "tasknotes.task",
  );
  if (!taskContract)
    throw new Error("TaskNotes pack provides no task contract.");
  return {
    manifest_version: 1,
    id: "dev.tasknotes.app",
    name: "TaskNotes",
    homepage: `${identityUrl}/`,
    icon: `${identityUrl}/icon.png`,
    redirect_uris: [
      `${identityUrl}/auth/mdbase/callback`,
      ...(!webOnly ? ["dev.tasknotes.app://auth/mdbase/callback"] : []),
    ],
    requirements: {
      contracts: [taskContract],
      capabilities: {
        contract_version: 1,
        required: [
          "collection.inspect",
          "records.watch",
          "records.read",
          "records.query",
          "records.create",
          "records.update",
          "records.delete",
          "records.rename",
          "views.list",
          "views.execute",
          "views.source.read",
          "views.source.create",
          "views.source.update",
          "views.source.delete",
          "definitions.read",
          "definitions.update",
          "definitions.type-pack.apply",
          "collection.setup.apply",
          "timers.reconcile",
          "files.list",
          "files.read",
          "files.add",
          "files.replace",
          "files.move",
          "files.delete",
        ],
        optional: ["notifications.background-delivery"],
      },
      access: "full_collection",
      files: {
        actions: ["list", "read", "add", "replace", "move", "delete"],
        scope: { kind: "collection" },
      },
      configuration: [
        {
          id: "tasknotes-base-sources",
          path: "/x-obsidian/bases/include",
          predicate: "contains",
          value: "TaskNotes/Views/**/*.base",
        },
      ],
    },
    provisions: {
      type_packs: [typePack, buildScratchpadTypePack()],
      configuration: [
        {
          requirement: "tasknotes-base-sources",
          operation: "set_add",
          path: "/x-obsidian/bases/include",
          value: "TaskNotes/Views/**/*.base",
        },
      ],
    },
    notifications: {
      criteria: [
        {
          id: "task.reminder",
          event: MDBASE_TIMER_FIRED_CONTRACT,
          presentation: {
            title: "Task reminder",
            body: "Open TaskNotes to view your task.",
            tag: "tasknotes-reminders",
          },
        },
      ],
      ...(firebaseProjectId
        ? {
            native_delivery: {
              mode: "managed_fcm",
              firebase_project_id: firebaseProjectId,
            },
          }
        : {}),
    },
  };
}
