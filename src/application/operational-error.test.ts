import { describe, expect, it } from "vitest";

import { OperationalError, toOperationalError } from "./operational-error";

describe("operational errors", () => {
  it.each([
    ["Network unavailable", "unavailable", true],
    ["Permission denied", "permission-denied", false],
    ["Revision conflict", "conflict", true],
    ["Invalid required field", "validation", false],
    ["Record not found", "not-found", false],
  ] as const)("classifies %s", (message, code, retryable) => {
    expect(toOperationalError(new Error(message), "update-task")).toMatchObject(
      { code, retryable, operation: "update-task", detail: message },
    );
  });

  it("does not wrap an already typed failure", () => {
    const failure = new OperationalError(
      "unavailable",
      "refresh",
      true,
      "Offline",
    );
    expect(toOperationalError(failure, "ignored")).toBe(failure);
  });
});
