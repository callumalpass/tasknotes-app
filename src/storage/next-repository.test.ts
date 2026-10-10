import { type PlainValue, type wire } from "@mdbase-dev/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTaskFixture } from "../test/next-task-fixture";
import { heldEditFromHold } from "./next-repository";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import type { TaskCreateIntent } from "../application/ports/task-repository";

const fixtures: Awaited<ReturnType<typeof nextTaskFixture>>[] = [];
afterEach(() => {
  fixtures.splice(0).forEach((fixture) => fixture.close());
  vi.restoreAllMocks();
});
async function fixture(...args: Parameters<typeof nextTaskFixture>) {
  const f = await nextTaskFixture(...args);
  fixtures.push(f);
  return f;
}

async function seed(
  f: Awaited<ReturnType<typeof fixture>>,
  title = "Portable task",
) {
  const portableId = crypto.randomUUID();
  const nativeId = crypto.randomUUID();
  const task = new TaskNotesTaskModel().create(
    { title, body: "Original body" },
    { id: portableId },
  );
  const write = await f.client.create({
    id: nativeId,
    type: "task",
    path: task.path,
    frontmatter: task.frontmatter as Record<string, PlainValue>,
    body: task.body,
  });
  await write.confirmed;
  return { portableId, nativeId, task };
}

describe("native TaskRepository operations (SDK stand-in, not LAB/Core/Noise)", () => {
  it("older creation ACKs read current metadata after a newer pending deletion, never recreate the task", async () => {
    const f = await fixture({ confirmDelayMs: null });
    const create = vi.spyOn(f.client, "create");
    const remove = vi.spyOn(f.client, "delete");
    const task = await f.repository.create({ title: "Locally deleted" });
    const nativeId = create.mock.calls[0]![0].id!;
    await f.repository.delete(task.id);
    expect(await f.client.find(nativeId)).toBeNull();
    f.replica.confirmAll();
    await vi.waitFor(() =>
      expect(
        f.repository.writeState({ kind: "task", id: task.id }),
      ).toBeUndefined(),
    );
    expect(await f.repository.get(task.id)).toBeNull();
    expect(create).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });
  it("keeps portable IDs separate and updates the observed native record", async () => {
    const f = await fixture();
    const s = await seed(f);
    await f.repository.initialize();
    expect((await f.repository.get(s.portableId))!.id).toBe(s.portableId);
    expect(await f.repository.get(s.nativeId)).toBeNull();
    const update = vi.spyOn(f.client, "update");
    const changed = await f.repository.update(s.portableId, {
      title: "Edited",
      body: "Changed body",
    });
    expect(changed.id).toBe(s.portableId);
    expect(changed.title).toBe("Edited");
    expect(changed.body).toBe("Changed body");
    const record = update.mock.calls[0]![0] as wire.RecordView;
    expect(record.id).toBe(s.nativeId);
    expect(record.revision).toMatch(/^sha256:/);
    expect(update.mock.calls[0]![1].ifRevision).toBe(record.revision);
    expect((await f.client.get(s.nativeId)).frontmatter.get("id")).toBe(
      s.portableId,
    );
  });

  it("completes and reopens a materialized occurrence with its parent atomically", async () => {
    const f = await fixture();
    const parent = await f.repository.create({
      title: "Series",
      scheduled: "2026-08-05",
      recurrence: "FREQ=DAILY;INTERVAL=1;DTSTART=20260805",
    });
    const occurrence = await f.repository.materializeOccurrence(
      parent.id,
      "2026-08-05",
    );
    const submit = vi.spyOn(f.client, "submit");
    expect(
      (await f.repository.toggle(occurrence.task.id, undefined, true))
        .completed,
    ).toBe(true);
    expect((await f.repository.get(parent.id))!.completeInstances).toContain(
      "2026-08-05",
    );
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]![0].map((op) => op.kind)).toEqual([
      "update",
      "update",
    ]);
    const ops = submit.mock.calls[0]![0];
    expect(ops.every((op) => op.kind === "update" && op.ifRevision)).toBe(true);
    expect(
      (await f.repository.toggle(occurrence.task.id, undefined, false))
        .completed,
    ).toBe(false);
    expect(
      (await f.repository.get(parent.id))!.completeInstances,
    ).not.toContain("2026-08-05");
  });

  it("skips and unskips a materialized occurrence with its parent", async () => {
    const base = defaultTaskCollectionConfiguration();
    const f = await fixture({}, false, {
      statuses: [
        ...base.statuses,
        {
          ...base.statuses[0]!,
          id: "skipped",
          value: "skipped",
          label: "Skipped",
          isCompleted: false,
          isSkipped: true,
        },
      ],
    });
    const parent = await f.repository.create({
      title: "Series",
      scheduled: "2026-08-05",
      recurrence: "FREQ=DAILY;INTERVAL=1;DTSTART=20260805",
    });
    const occurrence = await f.repository.materializeOccurrence(
      parent.id,
      "2026-08-05",
    );
    expect(
      (await f.repository.skip(occurrence.task.id, "2026-08-05")).skipped,
    ).toBe(true);
    expect((await f.repository.get(parent.id))!.skippedInstances).toContain(
      "2026-08-05",
    );
    expect(
      (await f.repository.skip(occurrence.task.id, "2026-08-05")).skipped,
    ).toBe(false);
    expect((await f.repository.get(parent.id))!.skippedInstances).not.toContain(
      "2026-08-05",
    );
  });

  it("refuses a missing skipped status before submitting a transition", async () => {
    const f = await fixture();
    const parent = await f.repository.create({
      title: "Series",
      scheduled: "2026-08-05",
      recurrence: "FREQ=DAILY;INTERVAL=1;DTSTART=20260805",
    });
    const occurrence = await f.repository.materializeOccurrence(
      parent.id,
      "2026-08-05",
    );
    const submit = vi.spyOn(f.client, "submit");
    await expect(
      f.repository.skip(occurrence.task.id, "2026-08-05"),
    ).rejects.toThrow("missing_skipped_status");
    expect(submit).not.toHaveBeenCalled();
    expect(
      (await f.repository.toggle(occurrence.task.id, undefined, true))
        .completed,
    ).toBe(true);
  });

  it("a locally captured transition reports rejection and rereads both rolled-back records", async () => {
    const f = await fixture({ confirmDelayMs: null });
    const parent = await f.repository.create({
      title: "Series",
      scheduled: "2026-08-05",
      recurrence: "FREQ=DAILY;INTERVAL=1;DTSTART=20260805",
    });
    const occurrence = await f.repository.materializeOccurrence(
      parent.id,
      "2026-08-05",
    );
    f.replica.confirmAll();
    await vi.waitFor(async () =>
      expect(await f.client.pendingWrites()).toEqual([]),
    );
    f.replica.setOnline(false);
    const submit = vi.spyOn(f.client, "submit");
    const local = await f.repository.toggle(
      occurrence.task.id,
      undefined,
      true,
    );
    expect(local.completed).toBe(true);
    const pending = (await f.client.pendingWrites())[0]!;
    expect((await f.client.pendingWrites()).length).toBe(1);
    expect(
      f.repository.writeState({ kind: "task", id: occurrence.task.id }),
    ).toBe("pending");
    f.replica.reject(pending.receipt.mutation, {
      code: "conflict",
      recovery: "refresh",
      message: "Parent revision changed",
    });
    await vi.waitFor(() =>
      expect(
        f.repository.writeState({ kind: "task", id: occurrence.task.id }),
      ).toBe("failed"),
    );
    expect(submit).toHaveBeenCalledOnce();
    expect((await f.repository.get(occurrence.task.id))!.completed).toBe(false);
    expect(
      (await f.repository.get(parent.id))!.completeInstances,
    ).not.toContain("2026-08-05");
  });

  it("creates a requested next occurrence in the same atomic transition", async () => {
    const f = await fixture();
    const parent = await f.repository.create({
      title: "Series",
      scheduled: "2026-08-05",
      recurrence: "FREQ=DAILY;INTERVAL=1;DTSTART=20260805",
      occurrenceMaterialization: "on_completion",
      occurrenceNextTrigger: "completion",
    });
    const occurrence = await f.repository.materializeOccurrence(
      parent.id,
      "2026-08-05",
    );
    const submit = vi.spyOn(f.client, "submit");
    await f.repository.toggle(occurrence.task.id, undefined, true);
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]![0].map((op) => op.kind)).toEqual([
      "update",
      "update",
      "create",
    ]);
    const tasks = await f.repository.listSummaries();
    expect(
      tasks.filter((task) => task.occurrenceDate === "2026-08-06"),
    ).toHaveLength(1);
    expect(
      tasks.find((task) => task.occurrenceDate === "2026-08-06")!.completed,
    ).toBe(false);
  });

  it("recovers a lost occurrence transition ACK without another toggle or batch", async () => {
    const f = await fixture();
    const parent = await f.repository.create({
      title: "Series",
      scheduled: "2026-08-05",
      recurrence: "FREQ=DAILY;INTERVAL=1;DTSTART=20260805",
    });
    const occurrence = await f.repository.materializeOccurrence(
      parent.id,
      "2026-08-05",
    );
    const submit = f.client.submit.bind(f.client);
    const spy = vi
      .spyOn(f.client, "submit")
      .mockImplementationOnce(async (...args) => {
        await submit(...args);
        throw new Error("Lost transition ACK");
      });
    await expect(f.repository.toggle(occurrence.task.id)).rejects.toMatchObject(
      { problem: { code: "operation_outcome_unknown" } },
    );
    expect((await f.repository.toggle(occurrence.task.id)).completed).toBe(
      true,
    );
    expect((await f.repository.get(parent.id))!.completeInstances).toContain(
      "2026-08-05",
    );
    expect(spy).toHaveBeenCalledOnce();
  });

  it("namespaces persisted intents by backend, consenting account and collection", async () => {
    const f = await fixture();
    const s = await seed(f);
    await f.repository.initialize();
    expect((await f.repository.collectionInfo()).id).toBe(
      `next:${f.accountId}:${f.client.collection}`,
    );
    f.repository.dispose();
    await expect(f.repository.get(s.portableId)).rejects.toThrow("disposed");
  });

  it("an uncertain update never remaps its original native target after refresh", async () => {
    const f = await fixture();
    const s = await seed(f);
    await f.repository.initialize();
    const update = f.client.update.bind(f.client);
    const spy = vi
      .spyOn(f.client, "update")
      .mockImplementationOnce(async (...args) => {
        await update(...args);
        throw new Error("Lost ACK");
      });
    await expect(
      f.repository.update(s.portableId, { title: "Original edit" }),
    ).rejects.toMatchObject({ problem: { code: "operation_outcome_unknown" } });
    await (
      await f.client.delete(await f.client.get(s.nativeId))
    ).confirmed;
    const replacementId = crypto.randomUUID();
    await (
      await f.client.create({
        id: replacementId,
        type: "task",
        path: s.task.path,
        frontmatter: s.task.frontmatter as Record<string, PlainValue>,
        body: "Replacement",
      })
    ).confirmed;
    await f.repository.refresh();
    await expect(
      f.repository.update(s.portableId, { title: "Original edit" }),
    ).rejects.toMatchObject({
      problem: {
        code: "operation_outcome_unknown",
        details: { request_id: spy.mock.calls[0]![2]!.mutationId },
      },
      cause: { code: "not_found" },
    });
    expect(spy).toHaveBeenCalledOnce();
    expect((await f.client.get(replacementId, { body: true })).body).toBe(
      "Replacement",
    );
  });

  it("returns summaries without body reads and hydrates only requested documents", async () => {
    const f = await fixture();
    const s = await seed(f);
    const get = vi.spyOn(f.client, "get");
    const summaries = await f.repository.listSummaries();
    expect(summaries[0]).not.toHaveProperty("body");
    expect(get).not.toHaveBeenCalled();
    expect((await f.repository.get(s.portableId))!.body).toBe("Original body");
    expect(get.mock.calls.at(-1)![1]).toMatchObject({ body: true });
  });

  it("returns genuine local capture before ACK and deduplicates the original intent without another submit", async () => {
    const f = await fixture({ confirmDelayMs: null });
    const intent: TaskCreateIntent = { id: crypto.randomUUID() };
    const create = vi.spyOn(f.client, "create");
    let done = false;
    const result = f.repository
      .create({ title: "One capture" }, intent)
      .then((task) => {
        done = true;
        return task;
      });
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    await vi.waitFor(async () =>
      expect((await f.client.pendingWrites()).length).toBe(1),
    );
    const saved = await result;
    expect(done).toBe(true);
    expect(saved.id).toBe(intent.id);
    expect((await f.client.get(intent.id, { body: true })).state.state).toBe(
      "pending",
    );
    const originalRequest = intent.authorityRequestId;
    expect(originalRequest).toBe(create.mock.calls[0]![1]!.mutationId);
    expect(
      await f.repository.create({ title: "Not another capture" }, intent),
    ).toMatchObject({
      id: saved.id,
      title: "One capture",
    });
    expect(intent.authorityRequestId).toBe(originalRequest);
    expect(create).toHaveBeenCalledOnce();
    f.replica.confirmAll();
    await vi.waitFor(() => expect(intent.authorityRequestId).toBeUndefined());
    expect(
      await f.repository.create({ title: "Still not another capture" }, intent),
    ).toMatchObject({
      id: saved.id,
      title: "One capture",
    });
    expect(create).toHaveBeenCalledOnce();
  });

  it("a failed native create read keeps exact capture recovery instead of inviting a replacement create", async () => {
    const f = await fixture({ confirmDelayMs: null });
    await f.repository.initialize({ deferTaskIndex: true });
    const create = vi.spyOn(f.client, "create");
    const intent = {
      id: crypto.randomUUID(),
      authorityRequestId: undefined as string | undefined,
    };
    const get = f.client.get.bind(f.client);
    let interrupted = false;
    const read = vi
      .spyOn(f.client, "get")
      .mockImplementation(async (...args) => {
        if (args[0] === intent.id && !interrupted) {
          interrupted = true;
          throw new Error("Confirmed record read interrupted");
        }
        return get(...args);
      });
    const failure = await f.repository
      .create({ title: "Original captured title" }, intent)
      .catch((reason: unknown) => reason);
    const requestId = create.mock.calls[0]![1]!.mutationId;
    expect(failure).toMatchObject({
      problem: {
        code: "operation_outcome_unknown",
        recovery: "resolve_outcome",
        details: { request_id: requestId },
      },
      cause: { message: "Confirmed record read interrupted" },
    });
    expect(intent.authorityRequestId).toBe(requestId);
    const lookup = vi.spyOn(f.client, "receipt");
    const saved = await f.repository.create(
      { title: "Must not replace original input" },
      intent,
    );
    expect(saved.id).toBe(intent.id);
    expect(saved.title).toBe("Original captured title");
    expect(create).toHaveBeenCalledOnce();
    expect(
      read.mock.calls
        .filter(([target]) => target === intent.id)
        .map(([target]) => target),
    ).toEqual([intent.id, intent.id]);
    expect(lookup).toHaveBeenCalledWith(requestId, expect.any(AbortSignal));
    expect(intent.authorityRequestId).toBe(requestId);
    expect((await f.client.get(intent.id, { body: true })).state.state).toBe(
      "pending",
    );
    f.replica.confirmAll();
    await vi.waitFor(() => expect(intent.authorityRequestId).toBeUndefined());
    expect(create).toHaveBeenCalledOnce();
  });

  it("recovers a lost create ACK with the original mutation and record ID", async () => {
    const f = await fixture();
    const intent: TaskCreateIntent = { id: crypto.randomUUID() };
    const create = f.client.create.bind(f.client);
    const spy = vi
      .spyOn(f.client, "create")
      .mockImplementationOnce(async (...args) => {
        await create(...args);
        throw new Error("Lost ACK");
      });
    await expect(
      f.repository.create({ title: "Captured once" }, intent),
    ).rejects.toMatchObject({ problem: { code: "operation_outcome_unknown" } });
    expect(intent.authorityRequestId).toBe(spy.mock.calls[0]![1]!.mutationId);
    const task = await f.repository.create(
      { title: "Changed retry input must not resubmit" },
      intent,
    );
    expect(task.title).toBe("Captured once");
    expect(task.id).toBe(intent.id);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("an independent second local capture never adopts or reissues an earlier uncertain capture", async () => {
    const f = await fixture();
    const first: TaskCreateIntent = { id: crypto.randomUUID() };
    const second: TaskCreateIntent = { id: crypto.randomUUID() };
    const create = f.client.create.bind(f.client);
    const spy = vi
      .spyOn(f.client, "create")
      .mockImplementationOnce(async (...args) => {
        await create(...args);
        throw new Error("Lost ACK");
      });
    await expect(
      f.repository.create({ title: "First" }, first),
    ).rejects.toMatchObject({ problem: { code: "operation_outcome_unknown" } });
    const originalRequest = first.authorityRequestId;
    expect((await f.repository.create({ title: "Second" }, second)).title).toBe(
      "Second",
    );
    expect(spy.mock.calls[1]![1]!.mutationId).not.toBe(originalRequest);
    expect(first.authorityRequestId).toBe(originalRequest);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(
      (await f.repository.create({ title: "Must not replace First" }, first))
        .title,
    ).toBe("First");
    expect(
      (await f.repository.create({ title: "Must not replace Second" }, second))
        .title,
    ).toBe("Second");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("a later create rejection remains visible and the same intent cannot reissue it", async () => {
    const f = await fixture({ confirmDelayMs: null });
    const intent: TaskCreateIntent = { id: crypto.randomUUID() };
    const create = vi.spyOn(f.client, "create");
    expect(
      (await f.repository.create({ title: "Rejected input" }, intent)).title,
    ).toBe("Rejected input");
    const rejectedId = intent.authorityRequestId!;
    f.replica.reject(rejectedId, {
      code: "invalid_request",
      recovery: "fix_request",
      message: "Missing required field",
    });
    await vi.waitFor(() =>
      expect(f.repository.writeState({ kind: "task", id: intent.id })).toBe(
        "failed",
      ),
    );
    expect(await f.client.find(intent.id)).toBeNull();
    await f.repository.reconcileWrites();
    await expect(
      f.repository.create({ title: "Must not reissue" }, intent),
    ).rejects.toMatchObject({ mutationId: rejectedId });
    expect(intent.authorityRequestId).toBe(rejectedId);
    expect(create).toHaveBeenCalledOnce();
    // A distinct, explicit new capture is not recovery of the rejected intent.
    const corrected: TaskCreateIntent = { id: crypto.randomUUID() };
    expect(
      (await f.repository.create({ title: "Corrected input" }, corrected))
        .title,
    ).toBe("Corrected input");
    expect(corrected.authorityRequestId).not.toBe(rejectedId);
    f.replica.confirmAll();
    await vi.waitFor(() =>
      expect(corrected.authorityRequestId).toBeUndefined(),
    );
    expect(create).toHaveBeenCalledTimes(2);
    expect(intent.authorityRequestId).toBe(rejectedId);
  });

  it("serializes overlapping edits without reading both from a stale revision", async () => {
    const f = await fixture();
    const s = await seed(f);
    await f.repository.initialize();
    await Promise.all([
      f.repository.update(s.portableId, { title: "First edit" }),
      f.repository.update(s.portableId, { priority: "high" }),
    ]);
    const task = (await f.repository.get(s.portableId))!;
    expect(task.title).toBe("First edit");
    expect(task.priority).toBe("high");
  });

  it("converges concurrent complete requests instead of toggling twice", async () => {
    const f = await fixture();
    const s = await seed(f);
    await f.repository.initialize();
    await Promise.all([
      f.repository.toggle(s.portableId, undefined, true),
      f.repository.toggle(s.portableId, undefined, true),
    ]);
    expect((await f.repository.get(s.portableId))!.completed).toBe(true);
  });

  it("archives the field and path in one atomic native mutation", async () => {
    const f = await fixture({}, true);
    const s = await seed(f);
    await f.repository.initialize();
    const submit = vi.spyOn(f.client, "submit");
    const archived = await f.repository.setArchived(s.portableId, true);
    expect(archived.archived).toBe(true);
    expect(archived.path).toMatch(/^TaskNotes\/Archive\//);
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]![0].map((op) => op.kind)).toEqual([
      "update",
      "rename",
    ]);
    expect((await f.client.get(s.nativeId)).path).toBe(archived.path);
  });

  it("deletes the observed native record, not a portable UUID guessed as native", async () => {
    const f = await fixture();
    const s = await seed(f);
    await f.repository.initialize();
    await f.repository.delete(s.portableId);
    expect(await f.client.find(s.nativeId)).toBeNull();
    expect(await f.repository.get(s.portableId)).toBeNull();
  });

  it("refuses duplicate portable identities instead of choosing the last record", async () => {
    const f = await fixture();
    const s = await seed(f);
    const write = await f.client.create({
      type: "task",
      path: "duplicate.md",
      frontmatter: s.task.frontmatter as Record<string, PlainValue>,
      body: "Another record",
    });
    await write.confirmed;
    await expect(f.repository.initialize()).rejects.toThrow(
      "same portable TaskNotes identity",
    );
  });

  it("refuses an incomplete index rather than presenting an empty collection", async () => {
    const f = await fixture();
    vi.spyOn(f.client, "query").mockResolvedValue({
      records: [],
      complete: false,
      asOf: 0,
    });
    await expect(f.repository.listSummaries()).rejects.toMatchObject({
      reason: "unsupported",
    });
  });

  it("refuses missing native view metadata without calling a placeholder executor", async () => {
    const f = await fixture();
    const execute = vi.spyOn(f.client.views, "execute");
    await expect(
      f.repository.executeView({
        key: "unadmitted#0",
        documentId: "unadmitted",
        documentName: "unadmitted",
        id: "0",
        name: "unadmitted",
        properties: [],
        source: {
          path: "unadmitted.base",
          format: "obsidian.base",
          revision: "sha256:" + "00".repeat(32),
          writable: false,
        },
      }),
    ).rejects.toMatchObject({
      reason: "unsupported",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("lifecycle cancellation prevents late create-read UI/cache installation", async () => {
    const f = await fixture({ confirmDelayMs: null });
    const create = vi.spyOn(f.client, "create");
    const intent: TaskCreateIntent = { id: crypto.randomUUID() };
    const get = f.client.get.bind(f.client);
    let entered!: () => void, release!: () => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let delayed = false;
    vi.spyOn(f.client, "get").mockImplementation(async (...args) => {
      const record = await get(...args);
      if (args[0] === intent.id && !delayed) {
        delayed = true;
        entered();
        await gate; // genuine decoded local result arriving after owner abort
      }
      return record;
    });
    const result = f.repository.create(
      { title: "Backgrounded capture" },
      intent,
    );
    const refused = expect(result).rejects.toMatchObject({
      problem: { code: "operation_outcome_unknown" },
    });
    await reading;
    expect(create).toHaveBeenCalledOnce();
    await vi.waitFor(async () =>
      expect((await f.client.pendingWrites()).length).toBe(1),
    );
    const originalRequest = intent.authorityRequestId;
    f.repository.suspend();
    const lateChange = vi.fn();
    const stop = f.repository.subscribe(lateChange);
    release();
    await refused;
    expect(lateChange).not.toHaveBeenCalled();
    stop();
    expect(intent.authorityRequestId).toBe(originalRequest);
    f.replica.confirmAll();
    f.repository.resume();
    expect(
      (await f.repository.create({ title: "No replay" }, intent)).title,
    ).toBe("Backgrounded capture");
    expect(create).toHaveBeenCalledOnce();
  });
});

describe("protected edits and sync position (hold UX)", () => {
  it("reports the backend's sync position in the connection status", async () => {
    const f = await fixture({ confirmDelayMs: null });
    await f.repository.refresh();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const status = await f.repository.connectionStatus();
    expect(status.sync?.text).toMatch(/plus \d+ pending, plus \d+ held$/);
    expect(status.heldEdits).toBeUndefined();
    await expect(
      f.repository.resolveHeldEdit(
        "018f6d2e-1c3a-7b4d-9e1f-2a3b4c5d6e7f",
        "keep_mine",
      ),
    ).rejects.toThrow(/no longer waiting/);
  });
  it("projects a hold as 'mdbase protected your edit' with the backend's own resolutions", () => {
    const edit = heldEditFromHold({
      id: "018f6d2e-1c3a-7b4d-9e1f-2a3b4c5d6e7f",
      path: "Tasks/plan.md",
      reason: "conflict",
      since: 1_700_000_000_000,
      mine: "mine",
      theirs: "theirs",
      saves: 2,
    });
    expect(edit.title).toBe("mdbase protected your edit");
    expect(edit.cause).not.toMatch(/stuck/i);
    expect(edit.actions.map((a) => a.action)).toEqual([
      "keep_mine",
      "take_theirs",
      "keep_both",
    ]);
    expect(
      edit.actions.find((a) => a.action === "take_theirs")?.discardsMine,
    ).toBe(true);
    expect(edit.saves).toBe(2);
    expect(edit.since).toBe("2023-11-14T22:13:20.000Z");
    const gone = heldEditFromHold({
      id: "018f6d2e-1c3a-7b4d-9e1f-2a3b4c5d6e7f",
      path: "Tasks/plan.md",
      reason: "deleted_elsewhere",
      since: 1,
      mine: "mine",
      saves: 0,
    });
    expect(gone.actions.map((a) => a.action)).toEqual(["keep_mine", "delete"]);
  });
});
