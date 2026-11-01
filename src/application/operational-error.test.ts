import { describe, expect, it } from "vitest";
import { MdbaseError, mdbaseError } from "@mdbase-dev/sdk";
import { OperationalError, toOperationalError } from "./operational-error";

describe("operational errors", () => {
  it.each([
    ["unavailable", "unavailable", true],
    ["forbidden", "permission-denied", false],
    ["conflict", "conflict", false],
    ["invalid_record", "validation", false],
    ["not_found", "not-found", false],
    ["cancelled", "cancelled", false],
  ] as const)(
    "classifies structured %s independently of wording",
    (providerCode, code, retryable) => {
      const error = mdbaseError(providerCode, "Neutral diagnostic");
      expect(toOperationalError(error, "update-task")).toMatchObject({
        code,
        retryable,
        operation: "update-task",
        detail: "Neutral diagnostic",
        problem: expect.objectContaining(error.toProblem()),
      });
    },
  );

  it("preserves exact unknown-outcome recovery even for a conflicting earlier write", () => {
    const error = new MdbaseError({
      code: "conflict",
      message: "Neutral diagnostic",
      recovery: "resolve_outcome",
      details: new Map([["request_id", "exact-request"]]),
    });
    const failure = toOperationalError(error, "create-task");
    expect(failure).toMatchObject({
      code: "outcome-unknown",
      retryable: false,
      problem: {
        recovery: "resolve_outcome",
        details: new Map([["request_id", "exact-request"]]),
      },
    });
  });

  it.each([
    "Network unavailable",
    "Permission denied",
    "Revision conflict",
    "Invalid required field",
    "Record not found",
  ])("does not derive policy from unstructured prose: %s", (message) => {
    expect(toOperationalError(new Error(message), "update-task")).toMatchObject(
      { code: "unknown", retryable: false },
    );
  });

  it("recognizes browser cancellation without declaring an outage", () => {
    expect(
      toOperationalError(
        new DOMException("Interrupted", "AbortError"),
        "refresh",
      ),
    ).toMatchObject({ code: "cancelled", retryable: false });
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
