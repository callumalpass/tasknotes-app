import { describe, expect, it } from "vitest";

import { buildTaskNotesManifest } from "./tasknotes-manifest.mjs";

const resources = {
  paths: { type: ".mdbase/types/task.md" },
  typeDocument: "---\nkind: mdbase.type\n---\n",
};

describe("TaskNotes mdbase manifest", () => {
  it("declares content-free runtime criteria without requiring Firebase", () => {
    const manifest = buildTaskNotesManifest({
      appUrl: "https://tasks.example",
      webOnly: true,
      resources,
    });
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.id).toBe("dev.tasknotes.app");
    expect(manifest.notifications.criteria).toEqual([
      {
        id: "task.reminder",
        event: { id: "timer.fired", version: 1 },
        presentation: {
          title: "Task reminder",
          body: "Open TaskNotes to view your task.",
          tag: "tasknotes-reminders",
        },
      },
    ]);
    expect(manifest.notifications.native_delivery).toBeUndefined();
    expect(JSON.stringify(manifest.notifications)).not.toContain("path");
  });

  it("adds only the public Firebase project ID when configured", () => {
    const manifest = buildTaskNotesManifest({
      appUrl: "https://tasks.example",
      webOnly: false,
      firebaseProjectId: "tasknotes-production",
      resources,
    });
    expect(manifest.notifications.native_delivery).toEqual({
      mode: "managed_fcm",
      firebase_project_id: "tasknotes-production",
    });
    expect(manifest.redirect_uris).toContain(
      "dev.tasknotes.app://auth/mdbase/callback",
    );
  });
});
