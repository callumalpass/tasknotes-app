import { describe, expect, it } from "vitest";

import { taskIdFromNotificationAction } from "./notifications";

describe("notification task routing", () => {
  it("reads task IDs from native object and serialized extras", () => {
    expect(
      taskIdFromNotificationAction({
        notification: { extra: { taskId: "a" } },
      }),
    ).toBe("a");
    expect(
      taskIdFromNotificationAction({
        notification: { extra: JSON.stringify({ taskId: "b" }) },
      }),
    ).toBe("b");
  });

  it("ignores malformed or unrelated notification actions", () => {
    expect(taskIdFromNotificationAction(null)).toBeNull();
    expect(
      taskIdFromNotificationAction({ notification: { extra: "not-json" } }),
    ).toBeNull();
    expect(
      taskIdFromNotificationAction({ notification: { extra: { path: "x" } } }),
    ).toBeNull();
  });
});
