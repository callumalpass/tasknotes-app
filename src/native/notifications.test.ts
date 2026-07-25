import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(async () => undefined),
  reconcileTimers: vi.fn(async (input: unknown) => input),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
}));
vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: { cancel: mocks.cancel },
}));
vi.mock("../cloud/connect", () => ({
  cloudConnect: { reconcileTimers: mocks.reconcileTimers },
}));

import {
  desiredTaskTimers,
  reconcileTaskNotifications,
  taskIdFromNotificationAction,
} from "./notifications";

import type { Task } from "../domain/task";
import type { TaskRepository } from "../storage/repository";

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

  it("projects only future absolute reminders into content-free authority timers", async () => {
    const task = {
      id: "task-a",
      completed: false,
      archived: false,
      reminders: [
        {
          id: "future",
          type: "absolute",
          absoluteTime: "2026-07-26T10:00:00+10:00",
          description: "Private reminder text",
        },
        {
          id: "past",
          type: "absolute",
          absoluteTime: "2026-07-24T10:00:00Z",
        },
        { id: "relative", type: "relative", offset: "PT15M" },
      ],
    } as Task;

    const timers = await desiredTaskTimers(
      [task],
      Date.parse("2026-07-25T00:00:00Z"),
    );
    expect(timers).toHaveLength(1);
    expect(timers[0]).toEqual({
      id: expect.stringMatching(/^[a-f0-9]{64}$/),
      fire_at: "2026-07-26T00:00:00.000Z",
    });
    expect(
      await desiredTaskTimers([task], Date.parse("2026-07-25T00:00:00Z")),
    ).toEqual(timers);
    expect(JSON.stringify(timers)).not.toContain("Private reminder text");
    expect(JSON.stringify(timers)).not.toContain("task-a");
    expect(JSON.stringify(timers)).not.toContain("future");
  });

  it("clears the device registry and keeps connected reminders only at the authority", async () => {
    localStorage.setItem(
      "tasknotes:notification-registry:v1",
      JSON.stringify({ "local-reminder": 42 }),
    );
    const repository = {
      list: vi.fn(async () => [
        {
          id: "task with an imported ID",
          completed: false,
          archived: false,
          reminders: [
            {
              id: "reminder with an imported ID",
              type: "absolute",
              absoluteTime: "2099-07-26T00:00:00Z",
            },
          ],
        } as Task,
      ]),
    } as unknown as TaskRepository;

    await reconcileTaskNotifications(repository, "connect");

    expect(mocks.cancel).toHaveBeenCalledWith({
      notifications: [{ id: 42 }],
    });
    expect(
      localStorage.getItem("tasknotes:notification-registry:v1"),
    ).toBeNull();
    expect(mocks.reconcileTimers).toHaveBeenCalledWith({
      namespace: "task-reminders",
      criterion_id: "task.reminder",
      timers: [
        {
          id: expect.stringMatching(/^[a-f0-9]{64}$/),
          fire_at: "2099-07-26T00:00:00.000Z",
        },
      ],
    });
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
