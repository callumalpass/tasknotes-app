import { describe, expect, it } from "vitest";

import {
  buildTaskNotesManifest,
  TASKNOTES_APP_TYPE_PACK_VERSION,
} from "./tasknotes-manifest.mjs";
import { buildAppTaskNotesResources } from "./tasknotes-resources.mjs";

describe("TaskNotes mdbase manifest", () => {
  it("declares content-free runtime criteria without requiring Firebase", async () => {
    const manifest = await buildTaskNotesManifest({
      appUrl: "https://tasks.example",
      webOnly: true,
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
    expect(manifest.requirements.capabilities.optional).toEqual([
      "notifications.background-delivery",
    ]);
    expect(manifest.requirements.capabilities.required).not.toContain(
      "sync.offline-replica",
    );
    expect(manifest.requirements.capabilities.required).toContain(
      "collection.setup.apply",
    );
    expect(manifest.requirements.capabilities.required).toEqual(
      expect.arrayContaining(["definitions.read", "definitions.update"]),
    );
    expect(manifest.requirements.configuration).toEqual([
      {
        id: "tasknotes-base-sources",
        path: "/x-obsidian/bases/include",
        predicate: "contains",
        value: "TaskNotes/Views/**/*.base",
      },
    ]);
    expect(manifest.provisions.configuration).toEqual([
      {
        requirement: "tasknotes-base-sources",
        operation: "set_add",
        path: "/x-obsidian/bases/include",
        value: "TaskNotes/Views/**/*.base",
      },
    ]);
    expect(manifest.provisions.type_packs[0].manifest.resources).toHaveLength(
      4,
    );
    expect(manifest.provisions.type_packs[0].manifest.version).toBe(
      TASKNOTES_APP_TYPE_PACK_VERSION,
    );
    expect(TASKNOTES_APP_TYPE_PACK_VERSION).toBe("0.3.0-rc.12");
    expect(manifest.provisions.type_packs[1]).toMatchObject({
      manifest: {
        id: "tasknotes.scratch",
        resources: [
          {
            kind: "type",
            mode: "seed",
            target: "_types/tasknotes-scratch.md",
            digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
          },
        ],
      },
      provides: [],
    });
    for (const pack of manifest.provisions.type_packs) {
      for (const resource of pack.manifest.resources) {
        expect(resource.mode).toMatch(/^(managed|seed)$/);
      }
    }
  });

  it("adds only the public Firebase project ID when configured", async () => {
    const manifest = await buildTaskNotesManifest({
      appUrl: "https://tasks.example",
      webOnly: false,
      firebaseProjectId: "tasknotes-production",
    });
    expect(manifest.notifications.native_delivery).toEqual({
      mode: "managed_fcm",
      firebase_project_id: "tasknotes-production",
    });
    expect(manifest.redirect_uris).toContain(
      "dev.tasknotes.app://auth/mdbase/callback",
    );
  });

  it("keeps local identity and callback URLs on the same origin", async () => {
    const manifest = await buildTaskNotesManifest({
      appUrl: "http://127.0.0.1:4173/tasknotes-app",
      webOnly: true,
    });
    expect(manifest.homepage).toBe("http://127.0.0.1:4173/tasknotes-app/");
    expect(manifest.icon).toBe("http://127.0.0.1:4173/tasknotes-app/icon.png");
    expect(manifest.redirect_uris).toEqual([
      "http://127.0.0.1:4173/tasknotes-app/auth/mdbase/callback",
    ]);
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

  it("provisions useful status and priority colors", () => {
    const generated = buildAppTaskNotesResources();
    const implementation = generated.type.implements.find(
      (candidate) => candidate.contract === "tasknotes.task",
    );

    expect(
      Object.fromEntries(
        implementation.binding.status.definitions.map(({ value, color }) => [
          value,
          color,
        ]),
      ),
    ).toEqual({
      none: "#94a3b8",
      open: "#64748b",
      "in-progress": "#3b82f6",
      done: "#22c55e",
      cancelled: "#94a3b8",
    });
    expect(
      Object.fromEntries(
        implementation.binding.priority.definitions.map(({ value, color }) => [
          value,
          color,
        ]),
      ),
    ).toEqual({
      none: "#94a3b8",
      low: "#3b82f6",
      normal: "#f59e0b",
      high: "#ef4444",
    });
  });
});
