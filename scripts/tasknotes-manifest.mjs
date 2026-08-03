import { buildTaskNotesMdbaseTypePack } from "@tasknotes/model/mdbase";
import { MDBASE_TIMER_FIRED_CONTRACT } from "@mdbase-dev/connect-protocol";

export async function buildTaskNotesManifest({
  appUrl,
  webOnly,
  firebaseProjectId,
  resources,
}) {
  const typePack = await buildTaskNotesMdbaseTypePack(resources);
  const taskContract = typePack.provides.find(
    (contract) => contract.id === "tasknotes.task",
  );
  if (!taskContract)
    throw new Error("TaskNotes pack provides no task contract.");
  return {
    manifest_version: 1,
    id: "dev.tasknotes.app",
    name: "TaskNotes",
    homepage: `${appUrl}/`,
    icon: `${appUrl}/icon.png`,
    redirect_uris: [
      `${appUrl}/auth/mdbase/callback`,
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
          "definitions.type-pack.apply",
          "timers.reconcile",
          "files.list",
          "files.read",
          "files.add",
          "files.replace",
          "files.move",
          "files.delete",
        ],
        optional: ["sync.offline-replica", "notifications.background-delivery"],
      },
      access: "full_collection",
      files: {
        actions: ["list", "read", "add", "replace", "move", "delete"],
        scope: { kind: "collection" },
      },
    },
    provisions: {
      type_packs: [typePack],
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
