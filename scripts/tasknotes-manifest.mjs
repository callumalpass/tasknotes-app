import { buildTaskNotesMdbaseTypePack } from "@tasknotes/model/mdbase";
import { MDBASE_TIMER_FIRED_CONTRACT } from "@mdbase-dev/connect-protocol";
import { buildScratchpadTypePack } from "./scratchpad-type.mjs";

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
      access: "full_collection",
      files: {
        actions: ["list", "read", "add", "replace", "move", "delete"],
        scope: { kind: "collection" },
      },
    },
    provisions: {
      type_packs: [typePack, buildScratchpadTypePack()],
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
