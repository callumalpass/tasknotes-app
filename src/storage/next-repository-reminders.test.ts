import "fake-indexeddb/auto";

import { afterEach, expect, it, vi } from "vitest";

import { nextTaskFixture } from "../test/next-task-fixture";
import { desiredTaskTimers } from "../domain/reminder-timers";
import {
  NextTaskRepository,
  REMINDER_TIMER_CRITERION,
  REMINDER_TIMER_NAMESPACE,
  type ReminderTimers,
} from "./next-repository";

const fixtures: Awaited<ReturnType<typeof nextTaskFixture>>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.close()));

async function withTimers(timers: ReminderTimers | undefined) {
  const fixture = await nextTaskFixture();
  fixtures.push(fixture);
  const repository = new NextTaskRepository(
    fixture.client,
    "Reminder tasks",
    fixture.accountId,
    { clientOwnership: "borrowed", timers: () => timers },
  );
  await repository.initialize();
  return repository;
}

function fakeTimers() {
  const reconcile = vi.fn<ReminderTimers["reconcile"]>(async (input) => ({
    namespace: input.namespace,
    timers: [],
    cancelledIds: [],
  }));
  return { reconcile };
}

const future = "2099-01-02T09:00:00.000Z";
const later = "2099-03-04T09:00:00.000Z";

it("reconciles one timer per future reminder on open, unarchived tasks", async () => {
  const timers = fakeTimers();
  const repository = await withTimers(timers);
  const open = await repository.create({
    title: "Open",
    reminders: [
      { id: "r1", type: "absolute", absoluteTime: later },
      { id: "r2", type: "absolute", absoluteTime: future },
      { id: "past", type: "absolute", absoluteTime: "2001-01-01T00:00:00Z" },
    ],
  });
  const done = await repository.create({
    title: "Done",
    reminders: [{ id: "r3", type: "absolute", absoluteTime: future }],
  });
  await repository.toggle(done.id, undefined, true);
  const archived = await repository.create({
    title: "Archived",
    reminders: [{ id: "r4", type: "absolute", absoluteTime: future }],
  });
  await repository.setArchived(archived.id, true);

  await repository.reconcileReminders();

  const expected = await desiredTaskTimers([
    { ...open, reminders: [open.reminders[1]!, open.reminders[0]!] },
  ]);
  expect(expected).toHaveLength(2);
  const input = timers.reconcile.mock.lastCall![0];
  expect(input).toEqual({
    namespace: REMINDER_TIMER_NAMESPACE,
    criterionId: REMINDER_TIMER_CRITERION,
    // Earliest first; no task content leaves the collection.
    timers: expected,
  });
  expect(JSON.stringify(input)).not.toContain("Open");
});

it("clears timers once a task's reminders are removed", async () => {
  const timers = fakeTimers();
  const repository = await withTimers(timers);
  const task = await repository.create({
    title: "Call",
    reminders: [{ id: "r1", type: "absolute", absoluteTime: future }],
  });
  await repository.reconcileReminders();
  expect(timers.reconcile.mock.lastCall![0].timers).toHaveLength(1);

  await repository.update(task.id, { reminders: [] });
  await repository.reconcileReminders();
  expect(timers.reconcile.mock.lastCall![0].timers).toEqual([]);
});

it("does nothing without timer access", async () => {
  const repository = await withTimers(undefined);
  await repository.create({
    title: "Call",
    reminders: [{ id: "r1", type: "absolute", absoluteTime: future }],
  });
  await expect(repository.reconcileReminders()).resolves.toBeUndefined();
});

it("runs one more pass for calls made while a reconcile is in flight", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const timers = fakeTimers();
  timers.reconcile.mockImplementationOnce(async (input) => {
    await gate;
    return { namespace: input.namespace, timers: [], cancelledIds: [] };
  });
  const repository = await withTimers(timers);
  await repository.create({
    title: "First",
    reminders: [{ id: "r1", type: "absolute", absoluteTime: future }],
  });

  const first = repository.reconcileReminders();
  await vi.waitFor(() => expect(timers.reconcile).toHaveBeenCalledTimes(1));
  await repository.create({
    title: "Second",
    reminders: [{ id: "r2", type: "absolute", absoluteTime: later }],
  });
  const second = repository.reconcileReminders();
  const third = repository.reconcileReminders();
  release();
  await Promise.all([first, second, third]);

  // The two queued calls share one extra pass, which sees both tasks.
  expect(timers.reconcile).toHaveBeenCalledTimes(2);
  expect(timers.reconcile.mock.lastCall![0].timers).toHaveLength(2);
});

it("does not resend an unchanged timer set, but does after a change", async () => {
  const timers = fakeTimers();
  const repository = await withTimers(timers);
  const task = await repository.create({
    title: "Call",
    reminders: [{ id: "r1", type: "absolute", absoluteTime: future }],
  });
  await repository.reconcileReminders();
  await repository.reconcileReminders();
  expect(timers.reconcile).toHaveBeenCalledTimes(1);

  await repository.update(task.id, {
    reminders: [{ id: "r1", type: "absolute", absoluteTime: later }],
  });
  await repository.reconcileReminders();
  expect(timers.reconcile).toHaveBeenCalledTimes(2);
});

it("resends an unchanged set after the resend interval", async () => {
  const timers = fakeTimers();
  const repository = await withTimers(timers);
  await repository.create({
    title: "Call",
    reminders: [{ id: "r1", type: "absolute", absoluteTime: future }],
  });
  const now = vi.spyOn(Date, "now");
  await repository.reconcileReminders();
  now.mockReturnValue(Date.now() + 11 * 60_000);
  await repository.reconcileReminders();
  now.mockRestore();
  expect(timers.reconcile).toHaveBeenCalledTimes(2);
});
