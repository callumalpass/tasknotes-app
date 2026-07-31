import { describe, expect, it } from "vitest";

import { changeNotificationLabel } from "./notification-label";

describe("More notification status", () => {
  it("distinguishes checking, errors, and unsupported browsers", () => {
    expect(changeNotificationLabel({ state: "checking", optedIn: false })).toBe(
      "Checking",
    );
    expect(changeNotificationLabel({ state: "error", optedIn: false })).toBe(
      "Setup needs attention",
    );
    expect(
      changeNotificationLabel({ state: "unavailable", optedIn: false }),
    ).toBe("Not available in this browser");
  });
});
