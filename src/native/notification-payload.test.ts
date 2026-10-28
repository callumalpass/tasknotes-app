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
  ).toThrow();
  expect(() => parseNotificationPayload({ ...payload, version: 2 })).toThrow(
    "envelope version",
  );
});

it("drops optional app data from both push and native wake envelopes", async () => {
  const { readNotificationData } = await import("./notification-payload");
  const privateFields = {
    path: "tasks/private.md",
    title: "Private task",
    body: "Private notes",
    taskId: "task-1",
  };
  const parsed = parseNotificationPayload({ ...payload, ...privateFields });
  expect(parsed).toEqual(payload);
  expect(
    readNotificationData({ ...payload, ...privateFields, version: "1" }),
  ).toEqual(nativeNotificationData(payload));
  expect(readNotificationData({ ...payload, version: 2 })).toBeNull();
  expect(readNotificationData({ ...payload, signal_id: "" })).toBeNull();
  expect(
    readNotificationData({ ...payload, cursor: "contains whitespace" }),
  ).toBeNull();
  expect(() =>
    parseNotificationPayload({
      ...payload,
      presentation: { title: "a".repeat(81) },
    }),
  ).toThrow();
});
