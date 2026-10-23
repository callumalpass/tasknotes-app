import {
  MdbaseError,
  TimersApi,
  type AppTimersPort,
  type PlainValue,
} from "@mdbase-dev/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTaskFixture } from "../test/next-task-fixture";
import { NextTaskRepository } from "./next-repository";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { desiredTaskTimers } from "../domain/reminder-timers";

const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((close) => close());
  vi.restoreAllMocks();
});

const future = "2099-08-06T09:00:00.000Z";
const reminder = {
  id: "private-reminder-name",
  type: "absolute" as const,
  absoluteTime: future,
};
const unknown = () =>
  new MdbaseError({
    code: "outcome_unknown",
    recovery: "resolve_outcome",
    message: "Response lost",
  });

function timerService() {
  let current: Array<{
    id: string;
    fire_at: string;
    criterion_id: string;
    generation: number;
    status: string;
    created_at: string;
    updated_at: string;
    fired_at: null;
  }> = [];
  const port: AppTimersPort = {
    list: vi.fn(),
    put: vi.fn(),
    cancel: vi.fn(),
    registerWebPush: vi.fn(),
    unregisterWebPush: vi.fn(),
    registerFcm: vi.fn(),
    unregisterFcm: vi.fn(),
    reconcile: vi.fn(
      async (
        namespace: string,
        body: Parameters<AppTimersPort["reconcile"]>[1],
      ) => {
        const next = body.timers.map((timer) => ({
          ...timer,
          criterion_id: body.criterion_id,
          generation: 1,
          status: "scheduled",
          created_at: "2026-10-23T00:00:00Z",
          updated_at: "2026-10-23T00:00:00Z",
          fired_at: null,
        }));
        const result = {
          namespace,
          timers: next,
          cancelled_ids: current
            .filter((old) => !next.some((timer) => timer.id === old.id))
            .map((timer) => timer.id),
        };
        current = next;
        return result;
      },
    ),
  };
  return { port, timers: new TimersApi(port) };
}

async function fixture(
  options: { enabled?: boolean; confirmDelayMs?: number | null } = {},
) {
  const f = await nextTaskFixture({ confirmDelayMs: options.confirmDelayMs });
  cleanup.push(f.close);
  const service = timerService();
  const errors = vi.fn();
  const repository = new NextTaskRepository(
    f.client,
    "Reminder tests",
    f.accountId,
    {
      clientOwnership: "borrowed",
      timers: service.timers,
      remindersEnabled: options.enabled ?? false,
      onReminderError: errors,
    },
  );
  cleanup.push(() => repository.dispose());
  return { ...f, repository, service, errors };
}

async function seed(
  f: Awaited<ReturnType<typeof fixture>>,
  title = "Private task title",
) {
  const task = new TaskNotesTaskModel().create(
    { title, body: "Private task body", reminders: [reminder] },
    { id: crypto.randomUUID() },
  );
  const write = await f.client.create({
    id: crypto.randomUUID(),
    type: "task",
    path: task.path,
    frontmatter: task.frontmatter as Record<string, PlainValue>,
    body: task.body,
  });
  await write.confirmed;
  return task;
}

async function schedule(f: Awaited<ReturnType<typeof fixture>>) {
  await f.repository.setRemindersEnabled(true);
  return vi.mocked(f.service.port.reconcile);
}

// Real SDK CRUD/TimersApi, in-memory replica + recording CP port. These tests
// do not qualify native Core, migration handoff, a running scheduler or delivery.
describe("native repository reminder reconciliation", () => {
  it("requires explicit opt-in even with connection timers; initialization and refresh stay inert", async () => {
    const f = await fixture();
    await seed(f);
    await f.repository.initialize();
    await f.repository.refresh();
    await f.repository.reconcileReminders();
    expect(f.service.port.list).not.toHaveBeenCalled();
    expect(f.service.port.reconcile).not.toHaveBeenCalled();
    const submit = await schedule(f);
    expect(submit).toHaveBeenCalled();
  });

  it("reconciles pre-existing task records on deferred-index startup with only opaque IDs and instants", async () => {
    const f = await fixture({ enabled: true });
    const task = await seed(f);
    await f.repository.initialize({ deferTaskIndex: true });
    await f.repository.reconcileReminders();
    const calls = vi.mocked(f.service.port.reconcile).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const [namespace, body] = calls.at(-1)!;
    expect(namespace).toBe("task-reminders");
    expect(body.criterion_id).toBe("task.reminder");
    expect(body.timers).toEqual(
      (await desiredTaskTimers([task])).map(({ id, fireAt }) => ({
        id,
        fire_at: fireAt,
      })),
    );
    const recorded = JSON.stringify(calls);
    for (const secret of [
      task.id,
      task.title,
      task.path,
      task.body,
      reminder.id,
    ])
      expect(recorded).not.toContain(secret);
  });

  it("uses every native page rather than a partial UI list, and refuses incomplete, changing or failed snapshots", async () => {
    const f = await fixture();
    await f.repository.initialize({ deferTaskIndex: true });
    const one = await seed(f, "One");
    const two = await seed(f, "Two");
    const records = await f.client.query(
      { types: ["task"] },
      { effective: true },
    );
    const pages = vi
      .spyOn(f.client, "pages")
      .mockImplementation(async function* () {
        yield {
          records: records.records.slice(0, 1),
          complete: true,
          asOf: 42,
          cursor: "next",
        };
        yield { records: records.records.slice(1), complete: true, asOf: 42 };
      });
    const submit = await schedule(f);
    expect(submit.mock.calls.at(-1)![1].timers).toHaveLength(2);
    expect(
      new Set(submit.mock.calls.at(-1)![1].timers.map((timer) => timer.id)),
    ).toEqual(
      new Set((await desiredTaskTimers([one, two])).map((timer) => timer.id)),
    );
    submit.mockClear();
    for (const mode of ["incomplete", "changing", "failed", "empty"] as const) {
      pages.mockImplementation(async function* () {
        if (mode === "empty") return;
        yield {
          records: records.records.slice(0, 1),
          complete: mode !== "incomplete",
          asOf: 42,
          cursor: "next",
        };
        if (mode === "failed") throw new Error("Second page failed");
        yield {
          records: records.records.slice(1),
          complete: true,
          asOf: mode === "changing" ? 43 : 42,
        };
      });
      await expect(f.repository.reconcileReminders()).rejects.toThrow();
      expect(submit).not.toHaveBeenCalled();
    }
  });

  it("reconciles accepted writes, completion/reopen and deletion, without explicit refresh", async () => {
    const f = await fixture();
    await f.repository.initialize({ deferTaskIndex: true });
    const submit = await schedule(f);
    const task = await f.repository.create({
      title: "Write",
      reminders: [reminder],
    });
    await vi.waitFor(() =>
      expect(submit.mock.calls.at(-1)![1].timers).toHaveLength(1),
    );
    await f.repository.toggle(task.id);
    await vi.waitFor(() =>
      expect(submit.mock.calls.at(-1)![1].timers).toEqual([]),
    );
    await f.repository.toggle(task.id);
    await vi.waitFor(() =>
      expect(submit.mock.calls.at(-1)![1].timers).toHaveLength(1),
    );
    await f.repository.delete(task.id);
    await vi.waitFor(() =>
      expect(submit.mock.calls.at(-1)![1].timers).toEqual([]),
    );
  });

  it("discards a full snapshot changed before planning finishes", async () => {
    const f = await fixture();
    await seed(f);
    await f.repository.initialize({ deferTaskIndex: true });
    const records = await f.client.query(
      { types: ["task"] },
      { effective: true },
    );
    const original = f.client.pages.bind(f.client);
    vi.spyOn(f.client, "pages")
      .mockImplementationOnce(async function* () {
        yield { records: records.records, complete: true, asOf: 0 };
        const write = await f.client.update(records.records[0]!, {
          patch: { reminders: [] },
        });
        await write.confirmed;
      })
      .mockImplementation(original);
    const submit = await schedule(f);
    expect(
      submit.mock.calls.every(([, body]) => body.timers.length === 0),
    ).toBe(true);
  });

  it("reconciles synchronized edits through the watch with no UI subscriber", async () => {
    const f = await fixture();
    const task = await seed(f);
    await f.repository.initialize({ deferTaskIndex: true });
    const submit = await schedule(f);
    const record = (await f.client.query({ types: ["task"] })).records[0]!;
    const write = await f.client.update(record, { patch: { reminders: [] } });
    await write.confirmed;
    await vi.waitFor(() =>
      expect(submit.mock.calls.at(-1)![1].timers).toEqual([]),
    );
    expect(await f.repository.get(task.id)).not.toBeNull();
  });

  it("does not cancel an accepted task's timers from a pending deletion; reconciles after ACK", async () => {
    const f = await fixture({ confirmDelayMs: null });
    const task = await f.repository.create({
      title: "Confirmed before deletion",
      reminders: [reminder],
    });
    f.replica.confirmAll();
    await vi.waitFor(() =>
      expect(f.client.ledger.getSnapshot().pending).toEqual([]),
    );
    await f.repository.initialize();
    const submit = await schedule(f);
    submit.mockClear();
    await f.repository.delete(task.id);
    await expect(f.repository.reconcileReminders()).rejects.toThrow("waiting");
    expect(submit).not.toHaveBeenCalled();
    f.replica.confirmAll();
    await vi.waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls.at(-1)![1].timers).toEqual([]);
  });

  it("serializes and coalesces overlapping reconciliations; an ambiguous response does not replay inline", async () => {
    const f = await fixture();
    await f.repository.initialize({ deferTaskIndex: true });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = vi
      .mocked(f.service.port.reconcile)
      .getMockImplementation()!;
    const submit = vi
      .mocked(f.service.port.reconcile)
      .mockImplementationOnce(async (...args) => {
        await gate;
        return original(...args);
      });
    const first = f.repository.setRemindersEnabled(true);
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    const second = f.repository.reconcileReminders();
    const third = f.repository.reconcileReminders();
    expect(second).toBe(third);
    expect(submit).toHaveBeenCalledOnce();
    release();
    await Promise.all([first, second, third]);
    expect(submit).toHaveBeenCalledTimes(2);
    submit.mockClear();
    submit.mockRejectedValueOnce(unknown());
    await expect(f.repository.reconcileReminders()).rejects.toMatchObject({
      code: "outcome_unknown",
    });
    expect(submit).toHaveBeenCalledOnce();
    await f.repository.reconcileReminders();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]![1]).toEqual(submit.mock.calls[0]![1]);
  });

  it.each(["suspend", "dispose"] as const)(
    "%s cancels a pending snapshot before timer dispatch",
    async (action) => {
      const f = await fixture();
      await f.repository.initialize({ deferTaskIndex: true });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const pages = vi
        .spyOn(f.client, "pages")
        .mockImplementationOnce(async function* () {
          await gate;
          yield { records: [], complete: true, asOf: 0 };
        });
      const pending = f.repository.setRemindersEnabled(true);
      const failed = expect(pending).rejects.toThrow();
      await vi.waitFor(() => expect(pages).toHaveBeenCalledOnce());
      f.repository[action]();
      release();
      await failed;
      expect(f.service.port.reconcile).not.toHaveBeenCalled();
    },
  );

  it("pauses a pending snapshot before dispatch and drains it before channel changes", async () => {
    const f = await fixture();
    await f.repository.initialize({ deferTaskIndex: true });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pages = vi
      .spyOn(f.client, "pages")
      .mockImplementationOnce(async function* () {
        await gate;
        yield { records: [], complete: true, asOf: 0 };
      });
    const pending = f.repository.setRemindersEnabled(true);
    await vi.waitFor(() => expect(pages).toHaveBeenCalledOnce());
    let drained = false;
    const stopping = f.repository.setRemindersEnabled(false).then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await Promise.all([pending, stopping]);
    expect(drained).toBe(true);
    expect(f.service.port.reconcile).not.toHaveBeenCalled();
  });

  it("drains an admitted reconcile without aborting or dispatching a coalesced replacement", async () => {
    const f = await fixture();
    await f.repository.initialize({ deferTaskIndex: true });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = vi
      .mocked(f.service.port.reconcile)
      .getMockImplementation()!;
    const submit = vi
      .mocked(f.service.port.reconcile)
      .mockImplementationOnce(async (...args) => {
        await gate;
        return original(...args);
      });
    const pending = f.repository.setRemindersEnabled(true);
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    const repeated = f.repository.reconcileReminders();
    let drained = false;
    const stopping = f.repository.setRemindersEnabled(false).then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    expect(submit.mock.calls[0]![2].signal?.aborted).toBe(false);
    release();
    await Promise.all([pending, repeated, stopping]);
    expect(drained).toBe(true);
    expect(submit).toHaveBeenCalledOnce();
  });
});
