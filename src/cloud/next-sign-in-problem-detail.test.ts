import { isNextSignInProblemDetail } from "./next-sign-in-problem-detail";

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
const appNames = ["AppInstallationSignInError", "AppCloudCopyHostError"];
it("accepts representative bounded diagnostics from each category", () => {
  for (const detail of [
    { name: "AppInstallationSignInError", code: "fenced" },
    { name: "AppCollectionJoinError", code: null },
    { name: "MdbaseError", code: "unauthenticated" },
    { name: "DOMException", code: "QuotaExceededError" },
    { name: "TypeError", code: null },
  ])
    expect(isNextSignInProblemDetail(detail)).toBe(true);
});
it("refuses unbounded or category-crossed details", () => {
  for (const detail of [
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
  ])
    expect(isNextSignInProblemDetail(detail), JSON.stringify(detail)).toBe(
      false,
    );
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
