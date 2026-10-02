import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import {
  buildTaskNotesManifest,
  TASKNOTES_APP_TYPE_PACK_VERSION,
} from "./tasknotes-manifest.mjs";
import { buildAppTaskNotesResources } from "./tasknotes-resources.mjs";
import { loadCanonicalTaskNotesTypePack } from "./canonical-task-pack.mjs";
import {
  previousScratchpadTypeDocument,
  scratchpadTypeDocument,
} from "./scratchpad-type.mjs";
import {
  previousScratchImageTypeDocument,
  scratchImageTypeDocument,
} from "./scratch-image-type.mjs";
import { SCRATCHPAD_TYPE_DOCUMENT } from "../src/domain/scratchpad.ts";
import { parse } from "yaml";

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
        version: "0.3.0-rc.5",
        digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }),
      expect.objectContaining({ id: "obsidian.base", version: "1.0.0" }),
      expect.objectContaining({ id: "mdbase.view", version: "1.0.0" }),
    ]);
    expect(manifest.requirements.files).toEqual({
      required: ["list", "read", "add", "replace", "move", "delete"],
      scope: { kind: "collection" },
    });
    // Exact groups exclude v1 aliases and offline replication. Record and
    // file deletion remain deliberate, required grants for TaskNotes.
    expect(manifest.requirements.capabilities).toEqual({
      contract_version: 2,
      required: [
        "collection.read",
        "records.create",
        "records.edit",
        "records.delete",
        "definitions.manage",
        "background.schedule",
      ],
    });
    expect(manifest.requirements.configuration).toEqual([
      {
        id: "tasknotes-base-sources",
        path: "/x-obsidian/bases/include",
        predicate: "contains",
        value: "TaskNotes/Views/**/*.base",
      },
      {
        id: "tasknotes-markdown-records",
        path: "/settings/record_extensions",
        predicate: "contains",
        value: "md",
      },
      {
        id: "tasknotes-base-records",
        path: "/settings/record_extensions",
        predicate: "contains",
        value: "base",
      },
    ]);
    expect(manifest.provisions.configuration).toEqual([
      {
        requirement: "tasknotes-base-sources",
        operation: "set_add",
        path: "/x-obsidian/bases/include",
        value: "TaskNotes/Views/**/*.base",
      },
      {
        requirement: "tasknotes-markdown-records",
        operation: "set_add",
        path: "/settings/record_extensions",
        value: "md",
      },
      {
        requirement: "tasknotes-base-records",
        operation: "set_add",
        path: "/settings/record_extensions",
        value: "base",
      },
    ]);
    expect(manifest.provisions.type_packs[0].manifest.resources).toHaveLength(
      4,
    );
    expect(manifest.provisions.type_packs[0].manifest.version).toBe(
      TASKNOTES_APP_TYPE_PACK_VERSION,
    );
    expect(TASKNOTES_APP_TYPE_PACK_VERSION).toBe("0.3.0-rc.17");
    const taskSeed = manifest.provisions.type_packs[0].manifest.resources.find(
      (resource) => resource.kind === "type",
    );
    expect(taskSeed.mode).toBe("seed");
    expect(taskSeed.upgrade_from.document).toContain("0.3.0-rc.3");
    expect(taskSeed.upgrade_from.digest).toBe(
      `sha256:${createHash("sha256").update(taskSeed.upgrade_from.document).digest("hex")}`,
    );
    expect(manifest.provisions.type_packs[1]).toMatchObject({
      manifest: {
        id: "tasknotes.scratch",
        version: "1.2.0",
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
    expect(manifest.provisions.type_packs[2]).toMatchObject({
      manifest: {
        id: "tasknotes.scratch-image",
        version: "1.2.0",
        resources: [
          {
            kind: "type",
            mode: "seed",
            target: "_types/tasknotes-scratch-image.md",
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

  it("keeps starter Scratchpad types portable across explicit type keys", async () => {
    // A collection chooses where explicit types are recorded
    // (settings.explicit_type_keys), for example mdbase_type. A starter that
    // declares or requires type would reject records created by naming the
    // type in such a collection.
    const manifest = await buildTaskNotesManifest({
      appUrl: "https://tasks.example",
      webOnly: true,
    });
    const cases = [
      {
        id: "tasknotes.scratch",
        name: "tasknotes-scratch",
        document: scratchpadTypeDocument,
        previous: previousScratchpadTypeDocument,
      },
      {
        id: "tasknotes.scratch-image",
        name: "tasknotes-scratch-image",
        document: scratchImageTypeDocument,
        previous: previousScratchImageTypeDocument,
      },
    ];
    for (const { id, name, document, previous } of cases) {
      const pack = manifest.provisions.type_packs.find(
        (candidate) => candidate.manifest.id === id,
      );
      const [resource] = pack.manifest.resources;
      expect(pack.resources).toEqual([{ source: resource.source, document }]);
      expect(resource.digest).toBe(
        `sha256:${createHash("sha256").update(document).digest("hex")}`,
      );
      const type = parse(document.split("---\n")[1]);
      expect(type).toMatchObject({ name, version: 2 });
      // Hand-written records that carry type are still recognised.
      expect(type.match).toEqual({ where: { type: { eq: name } } });
      const schema = type.schema.value;
      expect(schema.additionalProperties).toBe(true);
      for (const key of ["type", "types"]) {
        expect(schema.properties).not.toHaveProperty(key);
        expect(schema.required).not.toContain(key);
      }
      // Unedited version-1 seeds upgrade; edited copies stay the collection's.
      expect(resource.upgrade_from).toEqual({
        digest: `sha256:${createHash("sha256").update(previous).digest("hex")}`,
        document: previous,
      });
      expect(parse(previous.split("---\n")[1])).toMatchObject({
        name,
        version: 1,
      });
    }
    expect(SCRATCHPAD_TYPE_DOCUMENT).toBe(scratchpadTypeDocument);
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

  it("generates exactly the starter type the pinned pack installs", async () => {
    const pack = await loadCanonicalTaskNotesTypePack();
    const typeResource = pack.manifest.resources.find(
      (resource) => resource.target === "_types/task.md",
    );
    const document = pack.resources.find(
      (resource) => resource.source === typeResource.source,
    ).document;
    expect(buildAppTaskNotesResources().typeDocument).toBe(document);
  });

  it("provisions TaskNotes-compatible string ranks for manual order", () => {
    const generated = buildAppTaskNotesResources();
    const implementation = generated.type.implements.find(
      (candidate) =>
        candidate.contract === "tasknotes.task" &&
        candidate.version === "0.3.0-rc.5",
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
        candidate.version === "0.3.0-rc.5",
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
