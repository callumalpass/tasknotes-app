import { normalizeConnectProblem } from "@mdbase-dev/connect-protocol";
import { toOperationalError } from "./operational-error";
import { cutoverProblemFrom, migratingRetryDelayMs } from "./cutover-problem";
import { cutoverRefusal, CUTOVER_MESSAGES } from "../test/cutover-fixtures";

describe("cutoverProblemFrom", () => {
  it("recognises a moved collection through this SDK's unknown-code problem", () => {
    const reason = cutoverRefusal("moved");
    expect(reason.problem.code).toBe("unknown");
    expect(cutoverProblemFrom(reason)).toEqual({
      kind: "update",
      code: "collection_unavailable",
      message: CUTOVER_MESSAGES.moved,
      updateUrl: "https://mdbase.dev/downloads",
      supportUrl: null,
      retryAfterSeconds: null,
      minimumClientVersion: null,
    });
  });

  it("recognises onboarding_moved and keeps the minimum version", () => {
    expect(
      cutoverProblemFrom(
        cutoverRefusal("onboarding_moved", { minimum_client_version: "1.0.9" }),
      ),
    ).toMatchObject({
      kind: "update",
      code: "onboarding_moved",
      message: CUTOVER_MESSAGES.onboarding_moved,
      updateUrl: "https://mdbase.dev/downloads",
      minimumClientVersion: "1.0.9",
    });
  });

  it("recognises a migrating collection with its retry interval", () => {
    expect(cutoverProblemFrom(cutoverRefusal("migrating"))).toMatchObject({
      kind: "migrating",
      code: "collection_migrating",
      message: CUTOVER_MESSAGES.migrating,
      retryAfterSeconds: 300,
      updateUrl: null,
    });
  });

  it("recognises a suspended account and an optional support link", () => {
    expect(cutoverProblemFrom(cutoverRefusal("suspended"))).toMatchObject({
      kind: "suspended",
      code: "account_suspended",
      message: CUTOVER_MESSAGES.suspended,
      supportUrl: null,
    });
    expect(
      cutoverProblemFrom(
        cutoverRefusal("suspended", {
          support_url: "https://mdbase.dev/support",
        }),
      ),
    ).toMatchObject({ supportUrl: "https://mdbase.dev/support" });
  });

  it.each([
    ["migrating", "migrating"],
    ["suspended", "suspended"],
  ] as const)("accepts the short %s code", (code, kind) => {
    expect(
      cutoverProblemFrom({ problem: normalizeConnectProblem(code, "Wait.") }),
    ).toMatchObject({ kind, message: "Wait." });
  });

  it("reads a bare problem and an OperationalError carrying the problem", () => {
    const reason = cutoverRefusal("migrating");
    expect(cutoverProblemFrom(reason.problem)?.kind).toBe("migrating");
    expect(
      cutoverProblemFrom(toOperationalError(reason, "Saving the task").problem)
        ?.kind,
    ).toBe("migrating");
  });

  it("leaves ordinary failures to the existing behaviour", () => {
    // An ordinary unavailable collection has no moved reason or update URL.
    expect(
      cutoverProblemFrom({
        problem: normalizeConnectProblem(
          "collection_unavailable",
          "Collection sharing is unavailable.",
        ),
      }),
    ).toBeNull();
    expect(
      cutoverProblemFrom({
        problem: normalizeConnectProblem("connector_offline", "Offline."),
      }),
    ).toBeNull();
    expect(cutoverProblemFrom(new Error("collection_migrating"))).toBeNull();
    expect(cutoverProblemFrom("collection_migrating")).toBeNull();
    expect(cutoverProblemFrom(null)).toBeNull();
    expect(cutoverProblemFrom({ problem: { code: 409 } })).toBeNull();
  });

  it("falls back when the server sends no usable message", () => {
    expect(
      cutoverProblemFrom({
        problem: normalizeConnectProblem("collection_migrating", "   "),
      }),
    ).toBeNull();
  });

  it("ignores update links that are not https", () => {
    for (const update_url of ["javascript:alert(1)", "http://x.test", "nope"])
      expect(
        cutoverProblemFrom({
          problem: normalizeConnectProblem("onboarding_moved", "Update.", {
            details: { update_url },
          }),
        }),
      ).toMatchObject({ kind: "update", updateUrl: null });
  });
});

describe("migratingRetryDelayMs", () => {
  const middle = () => 0.5;
  it("starts at 30 seconds and doubles up to the server's interval", () => {
    expect(
      [0, 1, 2, 3, 4, 9].map((attempt) =>
        migratingRetryDelayMs(attempt, 300, middle),
      ),
    ).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
  });

  it("uses five minutes as the ceiling when the server gives none", () => {
    expect(migratingRetryDelayMs(8, null, middle)).toBe(300_000);
  });

  it("never waits longer than a short server interval", () => {
    expect(migratingRetryDelayMs(0, 10, middle)).toBe(10_000);
  });

  it("spreads checks by up to 20 percent", () => {
    expect(migratingRetryDelayMs(0, 300, () => 0)).toBe(24_000);
    expect(migratingRetryDelayMs(0, 300, () => 1)).toBe(36_000);
  });
});
