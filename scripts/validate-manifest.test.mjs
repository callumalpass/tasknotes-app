import { describe, expect, it } from "vitest";

import { buildTaskNotesManifest } from "./tasknotes-manifest.mjs";
import { validateManifestValue } from "./validate-manifest.mjs";

describe("TaskNotes manifest validation", () => {
  it("accepts the builder output with per-environment installation origins", async () => {
    const manifest = await buildTaskNotesManifest({
      appUrl: "https://staging.tasknotes-app.pages.dev",
      webOnly: true,
    });
    expect(validateManifestValue(manifest)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("refuses a non-exact staging installation origin", async () => {
    const manifest = await buildTaskNotesManifest({
      appUrl: "https://staging.tasknotes-app.pages.dev",
      webOnly: true,
    });
    const broken = {
      ...manifest,
      installation_origins: {
        staging: {
          "app-runtime": ["https://staging.tasknotes-app.pages.dev/"],
        },
      },
    };
    expect(validateManifestValue(broken).valid).toBe(false);
  });
});
