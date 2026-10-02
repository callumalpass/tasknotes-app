import { connectSuccess } from "@mdbase-dev/connect-testing";
import { describe, expect, it, vi } from "vitest";
import { MdbaseTaskRepository } from "./mdbase-repository";
import { runMdbaseMutation } from "./mdbase-mutation-coordinator";
import { deferred, mdbaseFixture } from "../test/mdbase-fixture";
import type { Task, TaskSummary } from "../domain/task";
import { AcceptedTaskEffects } from "../application/accepted-task-effects";
import {
  reconcileTaskNotifications,
  removeTaskNotifications,
  syncTaskNotifications,
  taskUpdateAffectsNotifications,
} from "../native/notifications";

const reminderTask = {
  id: "only-a",
  completed: false,
  archived: false,
  reminders: [
    { id: "a", type: "absolute", absoluteTime: "2099-07-26T00:00:00Z" },
  ],
} as TaskSummary;

function fixture() {
  const f = mdbaseFixture([]);
  const timers = vi.fn(
    async (input: { timers: unknown[] }, request: unknown) => {
      void request;
      return connectSuccess(input);
    },
  );
  Object.assign(f.connect, { reconcileTimers: timers });
  const repository = new MdbaseTaskRepository(f.connect);
  const list = vi.spyOn(repository, "listSummaries").mockResolvedValue([]);
  return { ...f, repository, timers, list };
}

describe("repository-owned reminder reconciliation", () => {
  it("writes content-free timers on its fixed connection with lifecycle cancellation", async () => {
    const f = fixture();
    f.list.mockResolvedValue([reminderTask]);
    await reconcileTaskNotifications(f.repository, "connect");
    expect(f.list).toHaveBeenCalledWith({ status: "open", limit: 50_000 });
    expect(f.timers).toHaveBeenCalledWith(
      {
        namespace: "task-reminders",
        criterionId: "task.reminder",
        timers: [
          {
            id: expect.stringMatching(/^[a-f0-9]{64}$/),
            fireAt: "2099-07-26T00:00:00.000Z",
          },
        ],
      },
      { timeoutMs: 45_000, signal: expect.any(AbortSignal) },
    );
  });

  it("keeps accepted command reminders background-only with one repository worker", async () => {
    const f = fixture();
    const candidates = deferred<TaskSummary[]>();
    f.list.mockReturnValueOnce(candidates.promise);
    const reconcile = vi.spyOn(f.repository, "reconcileReminders");
    const effects = new AcceptedTaskEffects({
      invalidate: vi.fn(),
      observe: () => undefined,
      forget: () => undefined,
      notify: (task) => syncTaskNotifications(f.repository, task, "connect"),
      removeNotifications: (id) =>
        removeTaskNotifications(f.repository, id, "connect"),
      affectsNotifications: taskUpdateAffectsNotifications,
    });
    expect(await effects.task(reminderTask as Task)).toBe(reminderTask);
    expect(reconcile).toHaveBeenCalledOnce();
    expect(f.timers).not.toHaveBeenCalled();
    candidates.resolve([reminderTask]);
    await reconcile.mock.results[0]!.value;
    expect(f.timers).toHaveBeenCalledOnce();
    await effects.deleted(reminderTask.id);
    await reconcile.mock.results[1]!.value;
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(f.timers).toHaveBeenCalledTimes(2);
    expect(f.timers.mock.calls[1]![0].timers).toEqual([]);
  });

  it("cancels delayed A candidates on collection replacement without blocking B", async () => {
    const a = fixture();
    const b = fixture();
    const candidates = deferred<TaskSummary[]>();
    a.list.mockReturnValueOnce(candidates.promise);
    const pendingA = reconcileTaskNotifications(a.repository, "connect");
    const rejectedA = expect(pendingA).rejects.toMatchObject({
      name: "AbortError",
    });
    a.repository.dispose();
    await reconcileTaskNotifications(b.repository, "connect");
    expect(b.timers).toHaveBeenCalledWith(
      expect.objectContaining({ timers: [] }),
      expect.anything(),
    );
    candidates.resolve([reminderTask]);
    await rejectedA;
    expect(a.timers).not.toHaveBeenCalled();
    expect(b.timers).toHaveBeenCalledOnce();
  });

  it("does not send a queued timer write after its owner is disposed", async () => {
    const f = fixture();
    const activeWrite = deferred<void>();
    const write = runMdbaseMutation(f.connect, () => activeWrite.promise, {
      key: "active",
      mapRecovered: () => undefined,
    });
    const pending = f.repository.reconcileReminders();
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() => expect(f.list).toHaveBeenCalledOnce());
    expect(f.timers).not.toHaveBeenCalled();
    f.repository.dispose();
    activeWrite.resolve();
    await write;
    await rejected;
    expect(f.timers).not.toHaveBeenCalled();
  });

  it("coalesces requests only within one repository generation", async () => {
    const f = fixture();
    const candidates = deferred<TaskSummary[]>();
    f.list.mockReturnValueOnce(candidates.promise);
    const first = f.repository.reconcileReminders();
    expect(f.repository.reconcileReminders()).toBe(first);
    candidates.resolve([]);
    await first;
    expect(f.timers).toHaveBeenCalledTimes(2);
    expect(f.list).toHaveBeenCalledTimes(2);
  });

  it("a resumed generation cannot join or be cleared by its cancelled predecessor", async () => {
    const f = fixture();
    const oldCandidates = deferred<TaskSummary[]>();
    const newCandidates = deferred<TaskSummary[]>();
    f.list
      .mockReturnValueOnce(oldCandidates.promise)
      .mockReturnValueOnce(newCandidates.promise);
    const old = f.repository.reconcileReminders();
    const rejected = expect(old).rejects.toMatchObject({ name: "AbortError" });
    f.repository.suspend();
    f.repository.resume();
    const current = f.repository.reconcileReminders();
    expect(current).not.toBe(old);
    oldCandidates.resolve([reminderTask]);
    await rejected;
    expect(f.repository.reconcileReminders()).toBe(current);
    newCandidates.resolve([]);
    await current;
    expect(f.timers).toHaveBeenCalledTimes(2);
    expect(
      f.timers.mock.calls.every(
        ([input]) => (input as { timers: unknown[] }).timers.length === 0,
      ),
    ).toBe(true);
  });

  it("waits for an active task write and propagates timer failures", async () => {
    const f = fixture();
    const activeWrite = deferred<void>();
    const write = runMdbaseMutation(f.connect, () => activeWrite.promise, {
      key: "active",
      mapRecovered: () => undefined,
    });
    const pending = f.repository.reconcileReminders();
    await Promise.resolve();
    expect(f.timers).not.toHaveBeenCalled();
    activeWrite.resolve();
    await write;
    await pending;
    f.timers.mockRejectedValueOnce(new Error("Timer service unavailable"));
    await expect(f.repository.reconcileReminders()).rejects.toThrow(
      "Timer service unavailable",
    );
    await f.repository.reconcileReminders();
    expect(f.timers).toHaveBeenCalledTimes(3);
  });
});
