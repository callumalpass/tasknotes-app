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
        event: {
          id: "mdbase.runtime.timer.fired",
          version: "1.0.0",
          digest:
            "sha256:41105be7a7abf33b31ced47e1e1965242236e40ccaea286b959b0a8c591f5642",
        },
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
      expect.objectContaining({
        id: "tasknotes.task",
        version: "0.3.0-rc.3",
        digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }),
    ]);
    expect(manifest.requirements.files).toEqual({
      actions: ["list", "read", "add", "replace", "move", "delete"],
      scope: { kind: "collection" },
    });
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
        candidate.version === "0.3.0-rc.3",
    );
    const field = implementation.fields.sortOrder;
    expect(generated.type.schema.value.properties[field]).toEqual({
      type: "string",
    });
    expect(generated.taskSchema.properties.sortOrder).toEqual({
      type: "string",
    });
    expect(
      JSON.parse(generated.taskSchemaDocument).properties.sortOrder,
    ).toEqual({
      type: "string",
    });
    expect(generated.typeDocument).toContain(
      "tasknotes_manual_order:\n        type: string",
    );
  });

  it("accepts date-only and timed due and scheduled values", () => {
    const generated = buildAppTaskNotesResources();
    const implementation = generated.type.implements.find(
      (candidate) =>
        candidate.contract === "tasknotes.task" &&
        candidate.version === "0.3.0-rc.3",
    );
    const taskDateSchema = {
      anyOf: [
        { type: "string", format: "date" },
        { type: "string", format: "date-time" },
      ],
    };

    expect(
      generated.type.schema.value.properties[implementation.fields.due],
    ).toEqual(taskDateSchema);
    expect(
      generated.type.schema.value.properties[implementation.fields.scheduled],
    ).toEqual(taskDateSchema);
    expect(generated.taskSchema.properties.due).toEqual(taskDateSchema);
    expect(generated.taskSchema.properties.scheduled).toEqual(taskDateSchema);
    expect(
      JSON.parse(generated.taskSchemaDocument).properties.scheduled,
    ).toEqual(taskDateSchema);
  });
});
