import { buildTaskNotesMdbaseTypePack } from "@tasknotes/model/mdbase";

export async function buildTaskNotesManifest({
  appUrl,
  webOnly,
  firebaseProjectId,
  resources,
}) {
  const typePack = await buildTaskNotesMdbaseTypePack(resources);
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
      contracts: [{ id: "tasknotes.task", version: "0.3.0-rc.1" }],
      access: "full_collection",
    },
    provisions: {
      type_packs: [typePack],
    },
    notifications: {
      criteria: [
        {
          id: "task.reminder",
          event: { id: "timer.fired", version: 1 },
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
