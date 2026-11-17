import { MdbaseError, mdbaseError } from "@mdbase-dev/sdk";
import {
  logViewDiscovery,
  VIEW_DISCOVERY_DIAGNOSTIC,
} from "./view-discovery-diagnostic";

afterEach(() => vi.restoreAllMocks());
function report(error?: unknown, viewCount: number | null = null) {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  logViewDiscovery({
    outcome: "error",
    stage: "discovery",
    viewCount,
    error,
    published: true,
    totalMs: 12.4,
    discoveryMs: 5.6,
  });
  expect(log).toHaveBeenCalledOnce();
  expect(log.mock.calls[0]![0]).toBe(VIEW_DISCOVERY_DIAGNOSTIC);
  const text = String(log.mock.calls[0]![1]);
  return { text, value: JSON.parse(text) };
}
it("emits only fixed own keys and correlated typed categories, never exception contents", () => {
  const error = new MdbaseError({
    code: "forbidden",
    reason: "insufficient_access",
    recovery: "reauthorize",
    message: "SECRET account/body/credential",
  });
  Object.assign(error, { details: { account: "SECRET" }, traceId: "SECRET" });
  const { text, value } = report(error);
  expect(Object.keys(value).sort()).toEqual([
    "code",
    "outcome",
    "published",
    "reason",
    "stage",
    "timings",
    "unreadableCount",
    "viewCount",
  ]);
  expect(value).toEqual({
    outcome: "error",
    stage: "discovery",
    viewCount: null,
    unreadableCount: null,
    code: "forbidden",
    reason: "insufficient_access",
    published: true,
    timings: { totalMs: 12, discoveryMs: 6 },
  });
  expect(text).not.toContain("SECRET");
});
it("rejects arbitrary and category-mismatched reasons", () => {
  const { text, value } = report(
    new MdbaseError({
      code: "unavailable",
      reason: "insufficient_access",
      recovery: "retry",
      message: "SECRET",
    }),
  );
  expect(value.reason).toBeNull();
  expect(text).not.toContain("SECRET");
});
it.each([
  ["invalid_request", "view_metadata_unavailable"],
  ["invalid_request", "view_unsupported_construct"],
  ["invalid_request", "query_budget_exceeded"],
  ["unavailable", "bases_contract_not_installed"],
  ["unavailable", "view_metadata_unavailable"],
  ["unavailable", "view_read_not_ready"],
  ["forbidden", "view_requires_keyed_device"],
  ["forbidden", "view_full_collection_required"],
  // A Cloud copy's discovery failed as conflict with a null reason
  // (tasknotes-app#436), hiding which check refused it.
  ["conflict", "concurrent_modification"],
] as const)("keeps the native discovery refusal %s/%s", (code, reason) => {
  // An unreadable view file refused discovery as invalid_request with a null
  // reason in the log, hiding which kind of refusal it was.
  const { value } = report(mdbaseError(code, "SECRET", reason));
  expect(value).toMatchObject({ code, reason });
});
it("does not borrow typed fields from plain objects or arbitrary exception messages", () => {
  const { value, text } = report({
    code: "forbidden",
    reason: "insufficient_access",
    message: "SECRET",
    stack: "SECRET",
  });
  expect(value.code).toBe("internal");
  expect(value.reason).toBeNull();
  expect(text).not.toContain("SECRET");
});
it.each(["ok", "empty"] as const)(
  "omits error classifications on %s",
  (outcome) => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    logViewDiscovery({
      outcome,
      stage: "discovery",
      viewCount: outcome === "ok" ? 1 : 0,
      unreadableCount: 2,
      error: Error("SECRET"),
      published: false,
      totalMs: Infinity,
      discoveryMs: -1,
    });
    expect(JSON.parse(String(log.mock.calls[0]![1]))).toMatchObject({
      outcome,
      unreadableCount: 2,
      code: null,
      reason: null,
      published: false,
      timings: { totalMs: null, discoveryMs: null },
    });
  },
);
it("logging failures cannot replace a discovery outcome", () => {
  vi.spyOn(console, "info").mockImplementation(() => {
    throw Error("console unavailable");
  });
  expect(() =>
    logViewDiscovery({
      outcome: "empty",
      stage: "discovery",
      viewCount: 0,
      published: true,
      totalMs: 1,
      discoveryMs: 1,
    }),
  ).not.toThrow();
});
