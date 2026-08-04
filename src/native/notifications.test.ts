import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const reconcileTimers = vi.fn(async (input: unknown) => input);
  return {
    connection: { reconcileTimers },
    reconcileTimers,
  };
});

vi.mock("../cloud/connect", () => ({
  cloudSession: {
    getSnapshot: () => ({
      status: "ready",
      connection: mocks.connection,
    }),
    connection: () => mocks.connection,
  },
}));

import {
  desiredTaskTimers,
  reconcileTaskNotifications,
  taskUpdateAffectsNotifications,
} from "./notifications";
import { runMdbaseMutation } from "../storage/mdbase-mutation-coordinator";

import type { Task } from "../domain/task";
import type { TaskRepository } from "../storage/repository";
import type { JsonObject, MdbaseConnection } from "@mdbase-dev/connect";

describe("mdbase task reminders", () => {
  beforeEach(() => {
    mocks.reconcileTimers.mockClear();
  });

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
        {
          id: "past",
          type: "absolute",
          absoluteTime: "2026-07-24T10:00:00Z",
        },
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
        fire_at: "2026-07-26T00:00:00.000Z",
      },
      {
        id: expect.stringMatching(/^[a-f0-9]{64}$/),
        fire_at: "2026-07-25T11:00:00.000Z",
      },
    ]);
    expect(
      await desiredTaskTimers([task], Date.parse("2026-07-25T00:00:00Z")),
    ).toEqual(timers);
    expect(JSON.stringify(timers)).not.toContain("Private reminder text");
    expect(JSON.stringify(timers)).not.toContain("Another private reminder");
    expect(JSON.stringify(timers)).not.toContain("task-a");
    expect(JSON.stringify(timers)).not.toContain("future");
  });

  it("keeps connected reminders at the mdbase authority", async () => {
    const repository = {
      syncStatus: vi.fn(async () => ({
        mode: "replicated",
        state: "synced",
        pending: 0,
        issues: 0,
      })),
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

  it("does no reminder work for a local collection", async () => {
    const repository = {
      list: vi.fn(async () => []),
    } as unknown as TaskRepository;

    await reconcileTaskNotifications(repository, "none");

    expect(repository.list).not.toHaveBeenCalled();
  });

  it("reconciles reminders for a live connector collection", async () => {
    const repository = {
      syncStatus: vi.fn(async () => ({
        mode: "live",
        state: "synced",
        pending: 0,
        issues: 0,
      })),
      list: vi.fn(async () => []),
    } as unknown as TaskRepository;

    await reconcileTaskNotifications(repository, "connect");

    expect(repository.list).toHaveBeenCalledWith({
      status: "open",
      limit: 50_000,
    });
    expect(mocks.reconcileTimers).toHaveBeenCalledWith({
      namespace: "task-reminders",
      criterion_id: "task.reminder",
      timers: [],
    });
  });

  it("waits for an active task write before reconciling reminders", async () => {
    const repository = {
      list: vi.fn(async () => []),
    } as unknown as TaskRepository;
    const connection =
      mocks.connection as unknown as MdbaseConnection<JsonObject>;
    const activeWrite = deferred<void>();
    const write = runMdbaseMutation(connection, () => activeWrite.promise);

    const reconciliation = reconcileTaskNotifications(repository, "connect");
    await Promise.resolve();
    expect(mocks.reconcileTimers).not.toHaveBeenCalled();

    activeWrite.resolve();
    await write;
    await reconciliation;
    expect(mocks.reconcileTimers).toHaveBeenCalledOnce();
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

function deferred<Result>() {
  let resolve!: (value: Result | PromiseLike<Result>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Result>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}
