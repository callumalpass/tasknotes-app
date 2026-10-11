import { logCollectionOpenFailure } from "./next-collection-open-diagnostic";
const script = "http://127.0.0.1:48218/assets/next-sign-in.worker-test.js";
afterEach(() => vi.restoreAllMocks());
function capture(error: unknown, url: string | undefined = script) {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  logCollectionOpenFailure("bootstrap", error, url);
  expect(log).toHaveBeenCalledOnce();
  expect(log.mock.calls[0]?.[0]).toBe("[TaskNotes collection open]");
  return JSON.parse(log.mock.calls[0]?.[1] as string);
}
it("records only fixed public failure metadata and owned-worker line/column frames", () => {
  const secret = "private-email@example.test private-token private-namespace";
  const error = Object.assign(Error(secret), {
    reason: "binding",
    accountId: secret,
  });
  error.stack = `Error: ${secret}\n at ${secret} (${script}:12:34)\n at foreign (https://other.example.test/path?token=secret:1:2)\n at credential (${script}?token=secret:1:3)`;
  const result = capture(error);
  expect(result).toEqual({
    stage: "bootstrap",
    name: "Error",
    reason: "binding",
    message: "public failure: binding",
    stack: ["owned-worker:12:34"],
  });
  expect(JSON.stringify(result)).not.toMatch(
    /private|example|secret|namespace|token|http/,
  );
});
it.each([
  [
    ReferenceError("MessageChannel is not defined"),
    "MessageChannel is not defined",
  ],
  [
    TypeError("Cannot read properties of undefined (reading 'isCurrent')"),
    "Cannot read properties of undefined (reading 'isCurrent')",
  ],
  [
    ReferenceError("private_token is not defined"),
    "unclassified exception (message redacted)",
  ],
  [
    TypeError("Cannot read properties of null (reading 'private_token')"),
    "unclassified exception (message redacted)",
  ],
  [
    TypeError("private_token is not a function"),
    "unclassified exception (message redacted)",
  ],
])(
  "reports a whitelisted builtin message or a redacted category",
  (error, message) => {
    expect(capture(error).message).toBe(message);
  },
);
it.each([
  null,
  "private-body",
  { name: "private-token", message: "private-body", stack: "private-custody" },
  Object.assign(Error("private"), { name: "private-token" }),
])("redacts arbitrary names, thrown values and message objects", (error) => {
  const result = capture(error);
  expect(result.name).toBe("Error");
  expect(result.reason).toBe("unknown");
  expect(result.message).toBe("unclassified exception (message redacted)");
});
it("bounds stack frames and omits locations when no owned script is supplied", () => {
  const error = Error("private-body");
  error.stack = Array.from(
    { length: 20 },
    (_, i) => `at fn (${script}:${i + 1}:2)`,
  ).join("\n");
  expect(capture(error).stack).toHaveLength(8);
  vi.restoreAllMocks();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  logCollectionOpenFailure("construct", error);
  expect(JSON.parse(log.mock.calls[0]?.[1] as string).stack).toEqual([]);
});
it("console and malformed frame failures cannot change the original operation outcome", () => {
  vi.spyOn(console, "error").mockImplementation(() => {
    throw Error("console failed");
  });
  expect(() =>
    logCollectionOpenFailure("sql_open", Error("private"), script),
  ).not.toThrow();
  expect(() =>
    logCollectionOpenFailure("construct", Error("private"), "invalid"),
  ).not.toThrow();
});
