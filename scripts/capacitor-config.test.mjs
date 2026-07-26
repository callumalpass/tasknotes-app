import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("native Capacitor configuration", () => {
  it("uses the Android bridge that is available across OEM WebViews", async () => {
    const source = await readFile(
      resolve(process.cwd(), "capacitor.config.ts"),
      "utf8",
    );

    expect(source).toMatch(/useLegacyBridge:\s*true/);
  });
});
