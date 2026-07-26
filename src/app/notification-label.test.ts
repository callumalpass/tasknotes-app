import { describe, expect, it } from "vitest";

import { changeNotificationLabel } from "./notification-label";

describe("More notification status", () => {
  it("does not describe an unfinished native check as a web-only feature", () => {
    expect(changeNotificationLabel({ state: "checking", optedIn: false })).toBe(
      "Checking",
    );
    expect(changeNotificationLabel({ state: "error", optedIn: false })).toBe(
      "Setup needs attention",
    );
    expect(
      changeNotificationLabel({ state: "unavailable", optedIn: false }),
    ).toBe("Available in the mobile app");
  });
});
