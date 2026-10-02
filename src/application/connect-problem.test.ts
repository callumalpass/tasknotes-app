import { expect, it } from "vitest";
import { connectError } from "@mdbase-dev/connect-testing";
import { connectProblemFromError } from "./connect-problem";

it.each([
  null,
  "connector_offline",
  new Error("connector_offline"),
  { code: "connector_offline" },
  { problem: null },
  { problem: "connector_offline" },
  { problem: {} },
  { problem: { code: 1, message: "Neutral" } },
  { problem: { code: "connector_offline" } },
  { problem: { code: "connector_offline", message: 1 } },
])("does not invent a structured problem from %j", (reason) => {
  expect(connectProblemFromError(reason)).toBeNull();
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
