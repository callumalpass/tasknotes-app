import { describe, expect, it } from "vitest";
import { connectError } from "@mdbase-dev/connect-testing";

import { isAuthorizationError, technicalErrorMessage } from "./auth-error";

describe("authorization errors", () => {
  it.each([
    "authorization_expired",
    "relay_authorization_expired",
    "collection_access_denied",
    "not_authorized",
    "authority_authorization_changed",
    "connector_identity_changed",
  ] as const)("recognizes %s as recoverable", (code) => {
    expect(isAuthorizationError(connectError(code, "Neutral diagnostic"))).toBe(
      true,
    );
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
