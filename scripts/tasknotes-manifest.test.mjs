import { describe, expect, it } from "vitest";

import { buildTaskNotesManifest } from "./tasknotes-manifest.mjs";
import { buildAppTaskNotesResources } from "./tasknotes-resources.mjs";

const resources = buildAppTaskNotesResources();

describe("TaskNotes mdbase manifest", () => {
  it("declares content-free runtime criteria without requiring Firebase", async () => {
    const manifest = await buildTaskNotesManifest({
      appUrl: "https://tasks.example",
      webOnly: true,
      resources,
    });
    expect(manifest.manifest_version).toBe(1);
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
    expect(manifest.requirements.contracts).toEqual([
      { id: "tasknotes.task", version: "0.2.0" },
    ]);
    expect(manifest.provisions.type_packs[0].manifest.resources).toHaveLength(
      4,
    );
  });

  it("adds only the public Firebase project ID when configured", async () => {
    const manifest = await buildTaskNotesManifest({
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

  it("provisions TaskNotes-compatible string ranks for manual order", () => {
    const generated = buildAppTaskNotesResources();
    const implementation = generated.type.implements.find(
      (candidate) =>
        candidate.contract === "tasknotes.task" &&
        candidate.version === "0.2.0",
    );
    const field = implementation.fields.sortOrder;
    expect(generated.type.schema.value.properties[field]).toEqual({
      type: "string",
    });
    expect(generated.typeDocument).toContain(
      "tasknotes_manual_order:\n        type: string",
    );
  });
});
