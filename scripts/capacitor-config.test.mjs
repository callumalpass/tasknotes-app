import { describe, expect, it } from "vitest";

import capacitorConfig, {
  TASKNOTES_NATIVE_APPLICATION_ORIGIN,
} from "../capacitor.config.ts";
import { buildTaskNotesManifest } from "./tasknotes-manifest.mjs";

describe("native Capacitor configuration", () => {
  it("uses the exact production manifest origin in native webviews", async () => {
    const manifest = await buildTaskNotesManifest({
      appUrl: TASKNOTES_NATIVE_APPLICATION_ORIGIN,
      webOnly: false,
    });
    const manifestOrigin = new URL(manifest.homepage).origin;

    expect(TASKNOTES_NATIVE_APPLICATION_ORIGIN).toBe(
      "https://app.tasknotes.dev",
    );
    expect(manifestOrigin).toBe(TASKNOTES_NATIVE_APPLICATION_ORIGIN);
    expect(
      `${capacitorConfig.server.androidScheme}://${capacitorConfig.server.hostname}`,
    ).toBe(manifestOrigin);
    expect(
      `${capacitorConfig.server.iosScheme}://${capacitorConfig.server.hostname}`,
    ).toBe(manifestOrigin);
  });
});
