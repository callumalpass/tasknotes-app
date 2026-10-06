import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTaskFixture } from "../test/next-task-fixture";
const fixtures: Awaited<ReturnType<typeof nextTaskFixture>>[] = [];
async function fixture() {
  const f = await nextTaskFixture();
  fixtures.push(f);
  vi.setSystemTime(new Date("2026-08-05T10:00:00Z"));
  return f;
}
afterEach(() => {
  fixtures.splice(0).forEach((f) => f.close());
  vi.useRealTimers();
});
const input = {
  title: "Rolling",
  scheduled: "2026-08-05",
  recurrence: "FREQ=DAILY;INTERVAL=1;DTSTART=20260805",
  occurrenceMaterialization: "rolling" as const,
  occurrencePastHorizon: "P0D",
  occurrenceFutureHorizon: "P2D",
};

describe("atomic native rolling windows (SDK stand-in, not Core/Noise/LAB)", () => {
  it("creates the parent and complete initial window as one native mutation", async () => {
    const f = await fixture();
    const submit = vi.spyOn(f.client, "submit");
    const parent = await f.repository.create(input);
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]![0].map((op) => op.kind)).toEqual([
      "create",
      "create",
      "create",
      "create",
    ]);
    const tasks = await f.repository.listSummaries();
    expect(
      tasks
        .filter((task) => task.id !== parent.id)
        .map((task) => task.occurrenceDate)
        .sort(),
    ).toEqual(["2026-08-05", "2026-08-06", "2026-08-07"]);
    expect(new Set(tasks.map((task) => task.path)).size).toBe(4);
  });
  it("extends a window atomically with the parent edit, without recreating existing dates", async () => {
    const f = await fixture();
    const parent = await f.repository.create(input);
    const submit = vi.spyOn(f.client, "submit");
    await f.repository.update(parent.id, { occurrenceFutureHorizon: "P4D" });
    expect(submit).toHaveBeenCalledOnce();
    const ops = submit.mock.calls[0]![0];
    expect(ops.map((op) => op.kind)).toEqual(["update", "create", "create"]);
    expect(ops[0]).toMatchObject({ ifRevision: expect.any(String) });
    expect(
      (await f.repository.listSummaries()).filter(
        (task) => task.occurrenceDate,
      ),
    ).toHaveLength(5);
    await f.repository.update(parent.id, { title: "Same window" });
    expect(
      (await f.repository.listSummaries()).filter(
        (task) => task.occurrenceDate,
      ),
    ).toHaveLength(5);
  });
  it("uncertain initial-window recovery observes the original parent batch rather than recreating children", async () => {
    const f = await fixture();
    const intent = {
      id: crypto.randomUUID(),
      authorityRequestId: undefined as string | undefined,
    };
    const submit = f.client.submit.bind(f.client);
    const spy = vi
      .spyOn(f.client, "submit")
      .mockImplementationOnce(async (...args) => {
        await submit(...args);
        throw new Error("Lost window ACK");
      });
    await expect(f.repository.create(input, intent)).rejects.toMatchObject({
      problem: { code: "operation_outcome_unknown" },
    });
    expect(intent.authorityRequestId).toBe(spy.mock.calls[0]![1]!.mutationId);
    expect((await f.repository.create(input, intent)).id).toBe(intent.id);
    expect(spy).toHaveBeenCalledOnce();
    expect(await f.repository.listSummaries()).toHaveLength(4);
  });
  it("rejects the entire window without leaving a parent or partial children", async () => {
    const f = await fixture();
    f.replica.setOnline(false);
    const intent = {
      id: crypto.randomUUID(),
      authorityRequestId: undefined as string | undefined,
    };
    const create = f.repository.create(input, intent);
    await vi.waitFor(async () =>
      expect((await f.client.pendingWrites()).length).toBe(1),
    );
    const pending = (await f.client.pendingWrites())[0]!;
    f.replica.reject(pending.receipt.mutation, {
      code: "conflict",
      recovery: "refresh",
      message: "Window collision at head",
    });
    await expect(create).rejects.toMatchObject({ code: "conflict" });
    expect(intent.authorityRequestId).toBeUndefined();
    expect(await f.repository.listSummaries()).toEqual([]);
  });
});
