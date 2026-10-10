import {
  signInErrorCode,
  signInMessage,
  logSignInFailure,
} from "./sign-in-error";

const codes = [
  "busy",
  "binding",
  "response",
  "refused",
  "expired",
  "account_confirmation_required",
  "recovery_required",
  "outcome_unknown",
  "fenced",
  "closed",
  "aborted",
  "unavailable",
];
it.each(codes)(
  "keeps the specific public %s reason without exposing error details",
  (code) => {
    const secret = "private-body-token-stand-in";
    const reason = Object.assign(Error(secret), {
      reason: code,
      response: { token: secret },
    });
    expect(signInErrorCode(code)).toBe(code);
    expect(signInErrorCode(reason)).toBe(code);
    expect(signInErrorCode(Error(`TaskNotes native sign-in: ${code}`))).toBe(
      code,
    );
    expect(signInMessage(reason)).not.toContain(secret);
    expect(signInMessage(reason)).not.toBe(
      "Sign-in was interrupted. Please try again.",
    );
  },
);
it.each([
  ["TaskNotes native sign-in is busy.", "busy"],
  ["TaskNotes native Worker is closed.", "closed"],
  ["TaskNotes sign-in owner closed.", "closed"],
  [
    "TaskNotes native outcome unknown; preserve storage and resume the original installation.",
    "outcome_unknown",
  ],
  [
    "TaskNotes native Worker stopped; preserve storage and resume the original installation.",
    "worker_stopped",
  ],
  ["popup_blocked", "popup_blocked"],
  ["Your browser blocked the sign-in window.", "popup_blocked"],
])("classifies the fixed transport/display error %s", (message, code) => {
  expect(signInErrorCode(Error(message))).toBe(code);
  expect(signInMessage(Error(message))).not.toBe(
    "Sign-in was interrupted. Please try again.",
  );
});
it.each([
  null,
  undefined,
  { reason: "busy", token: "stand-in" },
  Error("private-body"),
  Error("TaskNotes native sign-in: busy private-body"),
  "unknown_provider",
])("never echoes an arbitrary error or presentation value", (reason) => {
  expect(signInErrorCode(reason)).toBe("unknown");
  expect(signInMessage(reason)).toBe(
    "Sign-in was interrupted. Please try again.",
  );
});
it("diagnostics contain only a fixed phase/code and cannot mask the original failure", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const reason = Object.assign(Error("private-body"), {
    reason: "refused",
    accountId: "private-account",
    token: "private-token",
  });
  logSignInFailure("authorize", reason);
  expect(warn).toHaveBeenCalledExactlyOnceWith(
    "[TaskNotes sign-in] authorize: refused",
  );
  warn.mockImplementation(() => {
    throw Error("console unavailable");
  });
  expect(() => logSignInFailure("handoff", reason)).not.toThrow();
  warn.mockRestore();
});
