import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("installable web application metadata", () => {
  it("declares both standard and Apple standalone capability metadata", async () => {
    const html = await readFile(resolve("index.html"), "utf8");
    expect(html).toContain(
      '<meta name="mobile-web-app-capable" content="yes" />',
    );
    expect(html).toContain(
      '<meta name="apple-mobile-web-app-capable" content="yes" />',
    );
  });
});
