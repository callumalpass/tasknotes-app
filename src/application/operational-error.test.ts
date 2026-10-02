import { describe, expect, it } from "vitest";
import { connectError } from "@mdbase-dev/connect-testing";
import { OperationalError, toOperationalError } from "./operational-error";

describe("operational errors", () => {
  it.each([
    ["connector_offline", "unavailable", true],
    ["collection_access_denied", "permission-denied", false],
    ["concurrent_modification", "conflict", true],
    ["operation_invalid", "validation", false],
    ["file_not_found", "not-found", false],
    ["operation_cancelled", "cancelled", false],
  ] as const)(
    "classifies structured %s independently of wording",
    (providerCode, code, retryable) => {
      const error = connectError(providerCode, "Neutral diagnostic");
      expect(toOperationalError(error, "update-task")).toMatchObject({
        code,
        retryable,
        operation: "update-task",
        detail: "Neutral diagnostic",
        problem: error.problem,
      });
    },
  );

  it("preserves exact unknown-outcome recovery even when the category is availability", () => {
    const problem = {
      ...connectError("connector_offline", "Neutral diagnostic").problem,
      operation_outcome: "unknown",
      recovery: "resolve_outcome",
      details: { request_id: "exact-request" },
    };
    const failure = toOperationalError({ problem }, "create-task");
    expect(failure).toMatchObject({
      code: "outcome-unknown",
      retryable: false,
    });
    expect(failure.problem).toBe(problem);
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
