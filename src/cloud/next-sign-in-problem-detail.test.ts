import { isNextSignInProblemDetail } from "./next-sign-in-problem-detail";

const appNames = [
  "AppInstallationSignInError",
  "AppCloudCopyHostError",
  "AppCloudCopyBootstrapError",
  "AppCollectionSetupError",
  "AppCollectionControlError",
  "AppCollectionJoinError",
];
const appCodes = [
  "binding",
  "fenced",
  "busy",
  "account_confirmation_required",
  "outcome_unknown",
  "response",
  "refused",
  "expired",
  "recovery_required",
  "unavailable",
];
const mdbaseCodes = [
  "invalid_request",
  "invalid_record",
  "not_found",
  "conflict",
  "unauthenticated",
  "forbidden",
  "collection_invalid",
  "unavailable",
  "rate_limited",
  "quota_exceeded",
  "too_large",
  "upgrade_required",
  "outcome_unknown",
  "cancelled",
  "internal",
];
const domCodes = [
  "AbortError",
  "ConstraintError",
  "DataCloneError",
  "InvalidStateError",
  "NotAllowedError",
  "NotFoundError",
  "NotReadableError",
  "OperationError",
  "QuotaExceededError",
  "SecurityError",
  "TimeoutError",
  "TransactionInactiveError",
  "UnknownError",
  "VersionError",
];
const builtinNames = [
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "URIError",
  "EvalError",
  "Error",
  "UnknownError",
];
const valid = [
  ...appNames.flatMap((name) =>
    [...appCodes, null].map((code) => ({ name, code })),
  ),
  ...[...mdbaseCodes, null].map((code) => ({ name: "MdbaseError", code })),
  ...[...domCodes, null].map((code) => ({ name: "DOMException", code })),
  ...builtinNames.map((name) => ({ name, code: null })),
];
it.each(valid)("accepts the exact qualified diagnostic %j", (detail) => {
  expect(isNextSignInProblemDetail(detail)).toBe(true);
});
it.each([
  undefined,
  null,
  [],
  {},
  "Error",
  1,
  { name: "Error" },
  { code: null },
  { name: null, code: null },
  { name: "Error", code: undefined },
  { name: "Error", code: 1 },
  { name: "private-account-stand-in", code: null },
  { name: "AppCloudCopyHostError", code: "private-token-stand-in" },
  { name: "MdbaseError", code: "fenced" },
  { name: "DOMException", code: "outcome_unknown" },
  ...builtinNames.map((name) => ({ name, code: "fenced" })),
  ...appNames.map((name) => ({ name, code: "AbortError" })),
  ...[
    "message",
    "stack",
    "cause",
    "response",
    "accountId",
    "collectionId",
    "url",
  ].map((key) => ({ name: "Error", code: null, [key]: "private-stand-in" })),
])("refuses unbounded or category-crossed details %j", (detail) => {
  expect(isNextSignInProblemDetail(detail)).toBe(false);
});
it("requires exactly two own public fields, including nonenumerable/symbol rejection", () => {
  expect(
    isNextSignInProblemDetail(Object.create({ name: "Error", code: null })),
  ).toBe(false);
  expect(
    isNextSignInProblemDetail({
      name: "Error",
      code: null,
      [Symbol("extra")]: "stand-in",
    }),
  ).toBe(false);
  const hidden = Object.defineProperty(
    { name: "Error", code: null },
    "message",
    { value: "stand-in" },
  );
  expect(isNextSignInProblemDetail(hidden)).toBe(false);
});
it("refuses hostile objects without exposing their getters or replacing the failure", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const hostile = Object.defineProperty({ code: null }, "name", {
    get() {
      throw Error("private-stand-in");
    },
  });
  expect(isNextSignInProblemDetail(hostile)).toBe(false);
  expect(
    isNextSignInProblemDetail(
      new Proxy(
        {},
        {
          ownKeys() {
            throw Error("private-stand-in");
          },
        },
      ),
    ),
  ).toBe(false);
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});
