import { describe, expect, it } from "vitest";

import { storageExplanation } from "./storage-trust";

describe("storage trust copy", () => {
  it("distinguishes local, live, and replicated sources of truth", () => {
    expect(storageExplanation("local")).toContain(
      "Markdown files on this device are the source of truth",
    );
    expect(storageExplanation("live")).toContain(
      "changes require a connection",
    );
    expect(storageExplanation("replicated")).toContain("keeps an offline copy");
  });
});
