import { expect, it } from "vitest";
import { connectError } from "@mdbase-dev/connect-testing";
import { MdbaseError, mdbaseError } from "@mdbase-dev/sdk";
import { toOperationalError } from "./operational-error";
import { connectProblemFromError } from "./connect-problem";

it.each([
  null,
  "connector_offline",
  new Error("connector_offline"),
  { code: "connector_offline" },
  { code: "forbidden", message: "Neutral" },
  Object.assign(new Error("outcome_unknown"), {
    code: "outcome_unknown",
    recovery: "resolve_outcome",
  }),
  { problem: null },
  { problem: "connector_offline" },
  { problem: {} },
  { problem: { code: 1, message: "Neutral" } },
  { problem: { code: "connector_offline" } },
  { problem: { code: "connector_offline", message: 1 } },
])("does not invent a structured problem from %j", (reason) => {
  expect(connectProblemFromError(reason)).toBeNull();
});

it.each([
  ["outcome_unknown", "outcome-unknown", false],
  ["forbidden", "permission-denied", false],
  ["unauthenticated", "permission-denied", false],
  ["unavailable", "unavailable", true],
  ["rate_limited", "unavailable", true],
  ["quota_exceeded", "unavailable", false],
  ["cancelled", "cancelled", false],
  ["conflict", "conflict", false],
  ["invalid_request", "validation", false],
  ["invalid_record", "validation", false],
  ["too_large", "validation", false],
  ["not_found", "not-found", false],
  ["collection_invalid", "unknown", false],
  ["upgrade_required", "unknown", false],
  ["internal", "unknown", false],
] as const)(
  "classifies the real SDK's %s without guessing from its message",
  (code, expected, retryable) => {
    const error = mdbaseError(code, "Neutral developer diagnostic", {
      reason: "original_reason",
      traceId: "original_trace",
      retryAfterMs: 1200,
    });
    expect(connectProblemFromError(error)).toMatchObject(error.toProblem());
    const operational = toOperationalError(error, "Save task");
    expect(operational.code).toBe(expected);
    expect(operational.retryable).toBe(retryable);
    expect(operational.cause).toBe(error);
    expect(operational.problem?.recovery).toBe(error.recovery);
  },
);

it("keeps the original SDK write identity and does not make uncertain writes retryable", () => {
  const mutationId = "00000000-0000-4000-8000-000000000001";
  const mutationIds = [mutationId];
  const error = new MdbaseError(
    mdbaseError("outcome_unknown", "Neutral diagnostic").toProblem(),
    { mutationId, mutationIds },
  );
  const operational = toOperationalError(error, "Save task");
  expect(operational.code).toBe("outcome-unknown");
  expect(operational.retryable).toBe(false);
  expect(operational.cause).toBe(error);
  expect(operational.problem).toMatchObject({ mutationId, mutationIds });
});

it("preserves structured problems regardless of their carrier", () => {
  const error = connectError(
    "hosted_provider_unavailable",
    "Neutral diagnostic",
  );
  expect(connectProblemFromError(error)).toBe(error.problem);
  expect(connectProblemFromError({ problem: error.problem })).toBe(
    error.problem,
  );
});
