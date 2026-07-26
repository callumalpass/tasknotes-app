import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("native Capacitor configuration", () => {
  it("uses the proven Android push plugin without forcing a legacy bridge", async () => {
    const source = await readFile(
      resolve(process.cwd(), "capacitor.config.ts"),
      "utf8",
    );

    expect(source).toMatch(/@capacitor\/push-notifications/);
    expect(source).not.toMatch(/useLegacyBridge/);
  });
});
