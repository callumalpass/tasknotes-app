import {
  nativeNotificationData,
  parseNotificationPayload,
  showNotificationPayload,
} from "./notification-payload";

const payload = {
  type: "mdbase.notification" as const,
  version: 1 as const,
  signal_id: "signal-1",
  criterion_id: "task.reminder",
  cursor: "cursor-1",
  presentation: {
    title: "Task reminder",
    body: "Open TaskNotes to review it.",
    tag: "tasknotes-reminder",
  },
};

it("validates and presents content-free mdbase notifications", async () => {
  expect(parseNotificationPayload(payload)).toEqual(payload);
  expect(nativeNotificationData(payload)).toEqual({
    type: "mdbase.notification",
    version: 1,
    signal_id: "signal-1",
    criterion_id: "task.reminder",
    cursor: "cursor-1",
  });
  const showNotification = vi.fn(() => Promise.resolve());

  await showNotificationPayload({ showNotification }, payload);

  expect(showNotification).toHaveBeenCalledWith("Task reminder", {
    body: "Open TaskNotes to review it.",
    tag: "tasknotes-reminder",
    data: {
      type: "mdbase.notification",
      version: 1,
      signal_id: "signal-1",
      criterion_id: "task.reminder",
      cursor: "cursor-1",
    },
  });
});

it("rejects incomplete or content-bearing lookalikes", () => {
  expect(() => parseNotificationPayload(null)).toThrow("not an object");
  expect(() =>
    parseNotificationPayload({ ...payload, presentation: undefined }),
  ).toThrow("not an mdbase notification");
  expect(() => parseNotificationPayload({ ...payload, version: 2 })).toThrow(
    "not an mdbase notification",
  );
});
