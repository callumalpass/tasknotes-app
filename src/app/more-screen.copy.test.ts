import { describe, expect, it } from "vitest";

import { storageExplanation } from "./storage-trust";

describe("storage trust copy", () => {
  it("names mdbase as the direct source of truth", () => {
    expect(storageExplanation()).toContain("mdbase is the source of truth");
    expect(storageExplanation()).toContain("Changes require a connection");
    expect(storageExplanation()).not.toContain("offline copy");
  });
});
