import { type PlainValue, type wire } from "@mdbase-dev/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTaskFixture } from "../test/next-task-fixture";
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

  it("a rejected transition leaves both occurrence and parent unchanged", async () => {
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
    f.replica.setOnline(false);
    const transition = f.repository.toggle(occurrence.task.id, undefined, true);
    await vi.waitFor(async () =>
      expect((await f.client.pendingWrites()).length).toBe(1),
    );
    const pending = (await f.client.pendingWrites())[0]!;
    f.replica.reject(pending.receipt.mutation, {
      code: "conflict",
      recovery: "refresh",
      message: "Parent revision changed",
    });
    await expect(transition).rejects.toMatchObject({ code: "conflict" });
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
    ).rejects.toMatchObject({ code: "not_found" });
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

  it("deduplicates one capture intent only after authoritative confirmation", async () => {
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
    expect(done).toBe(false);
    f.replica.confirmAll();
    const saved = await result;
    expect(saved.id).toBe(intent.id);
    expect(
      await f.repository.create({ title: "Not another capture" }, intent),
    ).toBe(saved);
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

  it("a blocked second capture never adopts the earlier capture's request", async () => {
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
    await expect(
      f.repository.create({ title: "Second" }, second),
    ).rejects.toMatchObject({
      code: "conflict",
      reason: "earlier_mutation_pending",
    });
    expect(second.authorityRequestId).toBeUndefined();
    expect(first.authorityRequestId).toBe(originalRequest);
    expect(spy).toHaveBeenCalledOnce();
    await f.repository.create({ title: "First" }, first);
    expect((await f.repository.create({ title: "Second" }, second)).title).toBe(
      "Second",
    );
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("a definitive create rejection releases only that intent's failed request", async () => {
    const f = await fixture({ confirmDelayMs: null });
    const intent: TaskCreateIntent = { id: crypto.randomUUID() };
    const create = vi.spyOn(f.client, "create");
    const first = f.repository.create({ title: "Rejected input" }, intent);
    await vi.waitFor(async () =>
      expect((await f.client.pendingWrites()).length).toBe(1),
    );
    const rejectedId = intent.authorityRequestId!;
    f.replica.reject(rejectedId, {
      code: "invalid_request",
      recovery: "fix_request",
      message: "Missing required field",
    });
    await expect(first).rejects.toMatchObject({ code: "invalid_request" });
    expect(intent.authorityRequestId).toBeUndefined();
    const retry = f.repository.create({ title: "Corrected input" }, intent);
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(intent.authorityRequestId).not.toBe(rejectedId);
    f.replica.confirmAll();
    expect((await retry).title).toBe("Corrected input");
    expect(intent.authorityRequestId).toBeUndefined();
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
    await expect(f.repository.executeView()).rejects.toMatchObject({
      reason: "unsupported",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("lifecycle cancellation prevents late create-read UI/cache installation", async () => {
    const f = await fixture({ confirmDelayMs: null });
    const create = vi.spyOn(f.client, "create");
    const intent: TaskCreateIntent = { id: crypto.randomUUID() };
    const result = f.repository.create(
      { title: "Backgrounded capture" },
      intent,
    );
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    await vi.waitFor(async () =>
      expect((await f.client.pendingWrites()).length).toBe(1),
    );
    f.repository.suspend();
    await expect(result).rejects.toMatchObject({
      problem: { code: "operation_outcome_unknown" },
    });
    f.replica.confirmAll();
    f.repository.resume();
    expect(
      (await f.repository.create({ title: "No replay" }, intent)).title,
    ).toBe("Backgrounded capture");
    expect(create).toHaveBeenCalledOnce();
  });
});
