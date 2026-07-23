import { describe, expect, it } from "vitest";

import { isAuthorizationError, technicalErrorMessage } from "./auth-error";

describe("authorization errors", () => {
  it.each([
    "authorization_expired",
    "relay_authorization_expired",
    "invalid_grant",
    "not_authorized",
    "hosted_authorization_changed",
    "encryption_binding_stale",
  ])("recognizes %s as recoverable", (code) => {
    expect(isAuthorizationError({ code })).toBe(true);
  });

  it("does not classify storage failures as authorization errors", () => {
    expect(isAuthorizationError(new Error("Storage unavailable"))).toBe(false);
  });

  it("keeps technical detail available", () => {
    expect(technicalErrorMessage(new Error("Refresh token expired"))).toBe(
      "Refresh token expired",
    );
  });
});
