import { describe, expect, it, vi } from "vitest";
import {
  desiredTaskTimers,
  reconcileTaskNotifications,
  removeTaskNotifications,
  syncTaskNotifications,
  taskUpdateAffectsNotifications,
} from "./notifications";
import type { Task } from "../domain/task";
import type { TaskRepository } from "../application/ports/task-repository";

describe("mdbase task reminders", () => {
  it("projects future absolute and relative reminders into content-free authority timers", async () => {
    const task = {
      id: "task-a",
      completed: false,
      archived: false,
      scheduled: "2026-07-25T12:00:00Z",
      reminders: [
        {
          id: "future",
          type: "absolute",
          absoluteTime: "2026-07-26T10:00:00+10:00",
          description: "Private reminder text",
        },
        { id: "past", type: "absolute", absoluteTime: "2026-07-24T10:00:00Z" },
        {
          id: "relative",
          type: "relative",
          relatedTo: "scheduled",
          offset: "-PT1H",
          description: "Another private reminder",
        },
      ],
    } as Task;
    const timers = await desiredTaskTimers(
      [task],
      Date.parse("2026-07-25T00:00:00Z"),
    );
    expect(timers).toEqual([
      {
        id: expect.stringMatching(/^[a-f0-9]{64}$/),
        fireAt: "2026-07-26T00:00:00.000Z",
      },
      {
        id: expect.stringMatching(/^[a-f0-9]{64}$/),
        fireAt: "2026-07-25T11:00:00.000Z",
      },
    ]);
    expect(
      await desiredTaskTimers([task], Date.parse("2026-07-25T00:00:00Z")),
    ).toEqual(timers);
    expect(JSON.stringify(timers)).not.toContain("Private reminder text");
    expect(JSON.stringify(timers)).not.toContain("Another private reminder");
    expect(JSON.stringify(timers)).not.toContain("task-a");
    expect(JSON.stringify(timers)).not.toContain("future");
    expect(await desiredTaskTimers([{ ...task, archived: true }], 0)).toEqual(
      [],
    );
    expect(await desiredTaskTimers([{ ...task, completed: true }], 0)).toEqual(
      [],
    );
  });

  it("forwards all enabled reminder work to its repository owner", async () => {
    const repository = {
      reconcileReminders: vi.fn(async () => {}),
    } as unknown as TaskRepository;
    await reconcileTaskNotifications(repository, "connect");
    await syncTaskNotifications(repository, {} as Task, "connect");
    await removeTaskNotifications(repository, "one", "connect");
    expect(repository.reconcileReminders).toHaveBeenCalledTimes(3);
  });

  it("does no reminder work when delivery is disabled", async () => {
    const repository = {
      reconcileReminders: vi.fn(async () => {}),
    } as unknown as TaskRepository;
    await reconcileTaskNotifications(repository, "none");
    await syncTaskNotifications(repository, {} as Task);
    await removeTaskNotifications(repository, "one");
    expect(repository.reconcileReminders).not.toHaveBeenCalled();
  });

  it("reports missing authority support and reconciliation failures", async () => {
    await expect(
      reconcileTaskNotifications({} as TaskRepository, "connect"),
    ).rejects.toThrow("cannot reconcile reminders");
    const repository = {
      reconcileReminders: vi.fn(async () => {
        throw new Error("Unavailable");
      }),
    } as unknown as TaskRepository;
    await expect(
      reconcileTaskNotifications(repository, "connect"),
    ).rejects.toThrow("Unavailable");
  });

  it("does not reconcile reminders for manual-order-only updates", () => {
    expect(taskUpdateAffectsNotifications({ sortOrder: "tnaaaaaaaaaa" })).toBe(
      false,
    );
    expect(taskUpdateAffectsNotifications({ status: "done" })).toBe(true);
    expect(taskUpdateAffectsNotifications({ due: null })).toBe(true);
    expect(taskUpdateAffectsNotifications({ reminders: [] })).toBe(true);
  });
});
