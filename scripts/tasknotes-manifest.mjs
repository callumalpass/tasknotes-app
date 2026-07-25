export function buildTaskNotesManifest({
  appUrl,
  webOnly,
  firebaseProjectId,
  resources,
}) {
  return {
    manifest_version: 3,
    id: "dev.tasknotes.app",
    name: "TaskNotes",
    homepage: `${appUrl}/`,
    icon: `${appUrl}/icon.png`,
    redirect_uris: [
      `${appUrl}/auth/mdbase/callback`,
      ...(!webOnly ? ["dev.tasknotes.app://auth/mdbase/callback"] : []),
    ],
    requirements: {
      contracts: [{ id: "tasknotes.task", version: 1 }],
      access: "full_collection",
    },
    provisions: {
      types: [
        {
          name: "task",
          path: resources.paths.type,
          document: resources.typeDocument,
          provides: [{ id: "tasknotes.task", version: 1 }],
        },
      ],
    },
    notifications: {
      criteria: [
        criterion(
          "task.created",
          "mdbase.record.created",
          '"task" in event.payload.types',
          "A task was added",
        ),
        criterion(
          "task.changed",
          "mdbase.record.modified",
          '"task" in event.payload.types',
          "Tasks changed",
        ),
        criterion(
          "task.moved",
          "mdbase.record.renamed",
          '"task" in event.payload.types',
          "Tasks changed",
        ),
        criterion(
          "task.removed",
          "mdbase.record.deleted",
          '"task" in event.payload.types',
          "A task was removed",
        ),
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

function criterion(id, eventId, expression, title) {
  return {
    id,
    event: { id: eventId, version: 1 },
    if: { $expr: expression },
    debounce: "5s",
    minimum_interval: "15s",
    presentation: {
      title,
      body: "Open TaskNotes to see the latest changes.",
      tag: "tasknotes-changes",
    },
  };
}
