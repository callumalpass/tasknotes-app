import { MdbaseError, type wire } from "@mdbase-dev/sdk";
import { afterEach, expect, it, vi } from "vitest";
import { nextTaskFixture, seedTask } from "../test/next-task-fixture";
import { deferred } from "../test/deferred";

const fixtures: Awaited<ReturnType<typeof nextTaskFixture>>[] = [];
afterEach(() => {
  fixtures.splice(0).forEach((f) => f.close());
  vi.restoreAllMocks();
});
async function fixture(withCursor = false) {
  const f = await nextTaskFixture();
  fixtures.push(f);
  const { id } = seedTask(f.replica, { title: "Original" });
  const record = await f.client.get(id, { include: { effective: true } });
  const watch = f.client.watchChanges.bind(f.client);
  let deliver!: Parameters<typeof watch>[0];
  const watches = vi
    .spyOn(f.client, "watchChanges")
    .mockImplementation((cb, options) => {
      let cursor = options?.cursor ?? "0";
      deliver = (batch) => {
        cursor = batch.cursor;
        cb(batch);
      };
      const original = watch(deliver, options);
      if (!withCursor) return original;
      return Object.defineProperties(() => original(), {
        ready: { value: original.ready },
        subscribe: { value: original.subscribe },
        state: { get: () => original.state },
        error: { get: () => original.error },
        cursor: { get: () => cursor },
      }) as typeof original;
    });
  function push(changes: wire.Change[], reset = false) {
    deliver({ changes, cursor: "1", reset });
  }
  const change: wire.Change = {
    id,
    path: record.path,
    types: ["task"],
    kind: "put",
    version: 1,
  };
  const query = vi.spyOn(f.client, "query");
  const findRecord = f.client.find.bind(f.client);
  const find = vi.spyOn(f.client, "find");
  const taskReads = () =>
    find.mock.calls.filter(([id]) => typeof id === "string");
  return {
    ...f,
    id,
    record,
    change,
    push,
    query,
    find,
    findRecord,
    taskReads,
    watches,
  };
}

it("reads zero tasks on unchanged refresh and reconciles one edit with one find and no discovery or describe", async () => {
  const f = await fixture();
  await f.repository.initialize();
  const discovery = vi.spyOn(f.client, "listAppBasesViews").mockResolvedValue({
    kind: "success",
    views: [],
    unreadable: [],
    continuation: null,
    clock: { instant: 1, tz: "UTC", localDate: "1970-01-01" },
    collectionRevision: f.record.revision,
  });
  expect(await f.repository.listViews()).toEqual([]);
  f.query.mockClear();
  f.find.mockClear();
  expect(await f.repository.refresh()).toMatchObject({
    scanned: 0,
    changed: 0,
    removed: 0,
  });
  expect(f.taskReads()).toHaveLength(0);
  const describe = vi.mocked(f.client.describe);
  describe.mockClear();
  await (
    await f.client.update(f.record, { patch: { title: "External" } })
  ).confirmed;
  const [rows] = await Promise.all([
    f.repository.listSummaries(),
    f.repository.listSummaries(),
  ]);
  expect(rows[0]?.title).toBe("External");
  expect(await f.repository.listViews()).toEqual([]);
  expect(f.taskReads()).toHaveLength(1);
  expect(f.query).not.toHaveBeenCalled();
  expect(discovery).toHaveBeenCalledOnce();
  expect(describe).not.toHaveBeenCalled();
});

it("finishes the scan once and rereads negative type evidence delivered during a page", async () => {
  const f = await fixture();
  f.query
    .mockImplementationOnce(async () => {
      f.push([{ ...f.change, types: ["unrelated"] }]);
      return {
        asOf: 0,
        complete: true,
        records: [],
        hasMore: true,
        cursor: "page-2",
      };
    })
    .mockResolvedValueOnce({ asOf: 0, complete: true, records: [] });
  expect((await f.repository.listSummaries())[0]?.title).toBe("Original");
  expect(f.query.mock.calls.map(([q]) => q.cursor)).toEqual([
    undefined,
    "page-2",
  ]);
  expect(f.taskReads()).toHaveLength(1);
});

it.each(["cursor_stale", "cursor_expired"])(
  "restarts a refused partial scan and bounds repeated %s refusals",
  async (reason) => {
    const f = await fixture();
    const problem = new MdbaseError({
      code: "invalid_request",
      recovery: "refresh",
      reason,
      message: reason,
    });
    const first = {
      complete: true,
      asOf: 0,
      records: [f.record],
      hasMore: true,
      cursor: "stale-page",
    };
    const changedId = crypto.randomUUID();
    f.query
      .mockImplementationOnce(async () => {
        f.push([{ ...f.change, id: changedId }]);
        return first;
      })
      .mockRejectedValueOnce(problem)
      .mockResolvedValueOnce({ complete: true, asOf: 1, records: [] });
    expect(await f.repository.listSummaries()).toEqual([]);
    expect(f.query.mock.calls.map(([q]) => q.cursor)).toEqual([
      undefined,
      "stale-page",
      undefined,
    ]);
    expect(f.taskReads().map(([id]) => id)).toEqual([changedId]);
    f.push([], true);
    f.query.mockClear().mockRejectedValue(problem);
    await expect(f.repository.listSummaries()).rejects.toBe(problem);
    expect(f.query).toHaveBeenCalledTimes(3);
  },
);

it.each([true, false])(
  "resumes from the stopped watch only when it exposes a cursor (%s)",
  async (withCursor) => {
    const f = await fixture(withCursor);
    await f.repository.initialize();
    await (
      await f.client.update(f.record, { patch: { title: "Before suspend" } })
    ).confirmed;
    await f.repository.listSummaries();
    f.repository.suspend();
    await (
      await f.client.update(f.id, { patch: { title: "While suspended" } })
    ).confirmed;
    f.query.mockClear();
    f.find.mockClear();
    f.repository.resume();
    expect(await f.repository.refresh()).toMatchObject({ scanned: 1 });
    expect((await f.repository.listSummaries())[0]?.title).toBe(
      "While suspended",
    );
    expect(f.watches.mock.calls[1]?.[1]?.cursor).toEqual(
      withCursor ? expect.any(String) : undefined,
    );
    expect(f.query).toHaveBeenCalledTimes(withCursor ? 0 : 1);
    expect(f.taskReads()).toHaveLength(withCursor ? 1 : 0);
  },
);

it.each(["reset", "model", "overflow", "full changes page"] as const)(
  "falls back to a full load for %s",
  async (reason) => {
    const f = await fixture();
    await f.repository.initialize();
    f.query.mockClear();
    if (reason === "reset") f.push([], true);
    if (reason === "model")
      f.catalog.types[0]!.revision = "new-source-revision";
    if (reason === "overflow")
      f.push(
        Array.from({ length: 501 }, () => ({
          ...f.change,
          id: crypto.randomUUID(),
        })),
      );
    if (reason === "full changes page") f.push(Array(1000).fill(f.change));
    expect(await f.repository.refresh()).toMatchObject({ scanned: 1 });
    expect(f.query).toHaveBeenCalledOnce();
    expect(f.taskReads()).toHaveLength(0);
  },
);

it("checks duplicate portable identity with a full scan and surfaces the native rows' collision", async () => {
  const f = await fixture();
  await f.repository.initialize();
  const duplicate = seedTask(
    f.replica,
    { title: "Other" },
    { id: String(f.record.frontmatter.id), path: "other.md" },
  );
  f.push([{ ...f.change, id: duplicate.id, path: "other.md" }]);
  f.query.mockClear();
  await expect(f.repository.listSummaries()).rejects.toThrow(
    "same portable TaskNotes identity",
  );
  expect(f.query).toHaveBeenCalledOnce();
});

it.each(["direct first", "delta first", "late not-found"] as const)(
  "preserves the reconciled identity when overlapping reads finish: %s",
  async (order) => {
    const f = await fixture();
    await f.repository.initialize();
    const started = deferred<void>();
    const release = deferred<void>();
    const oldId = String(f.record.frontmatter.id);
    f.find.mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
      return order === "late not-found" ? null : f.record;
    });
    const direct = f.repository.getSummary(oldId);
    await started.promise;
    const newId = crypto.randomUUID();
    await (
      await f.client.update(f.id, {
        patch: { id: newId, title: "New identity" },
      })
    ).confirmed;
    if (order === "direct first") {
      release.resolve();
      await direct;
    }
    expect(await f.repository.listSummaries()).toMatchObject([
      { id: newId, title: "New identity" },
    ]);
    release.resolve();
    await direct;
    expect(await f.repository.listSummaries()).toMatchObject([
      { id: newId, title: "New identity" },
    ]);
    expect(await f.repository.getSummary(oldId)).toBeNull();
    expect(f.query).toHaveBeenCalledOnce();
  },
);

it("keeps an interrupted delta pending across cursor resume", async () => {
  const f = await fixture(true);
  await f.repository.initialize();
  await (
    await f.client.update(f.id, { patch: { title: "Pending at suspend" } })
  ).confirmed;
  const started = deferred<void>();
  const release = deferred<void>();
  f.find.mockImplementationOnce(async () => {
    started.resolve();
    await release.promise;
    return f.record;
  });
  const interrupted = f.repository.listSummaries();
  await started.promise;
  f.repository.suspend();
  release.resolve();
  await expect(interrupted).rejects.toMatchObject({ name: "AbortError" });
  f.repository.resume();
  expect(await f.repository.listSummaries()).toMatchObject([
    { title: "Pending at suspend" },
  ]);
  expect(f.query).toHaveBeenCalledOnce();
  expect(f.taskReads()).toHaveLength(2);
});

it("retains a failed or superseded put until the current value commits", async () => {
  const f = await fixture();
  await f.repository.initialize();
  f.push([f.change]);
  f.find.mockRejectedValueOnce(new Error("record read failed"));
  await expect(f.repository.listSummaries()).rejects.toThrow(
    "record read failed",
  );
  const started = deferred<void>();
  const release = deferred<void>();
  f.find.mockImplementationOnce(async () => {
    started.resolve();
    await release.promise;
    return f.record;
  });
  const rows = f.repository.listSummaries();
  await started.promise;
  f.replica.editElsewhere(f.id, { frontmatter: { title: "Newest" } });
  await f.client.get(f.id);
  release.resolve();
  expect(await rows).toMatchObject([{ title: "Newest" }]);
  expect(f.taskReads()).toHaveLength(3);
  expect(f.query).toHaveBeenCalledOnce();
});

it("rejects a find for the wrong UUID and retries the pending record", async () => {
  const f = await fixture();
  await f.repository.initialize();
  f.push([f.change]);
  f.find.mockResolvedValueOnce({ ...f.record, id: crypto.randomUUID() });
  await expect(f.repository.listSummaries()).rejects.toThrow(
    "original record identity",
  );
  expect(await f.repository.listSummaries()).toMatchObject([
    { title: "Original" },
  ]);
  expect(f.taskReads()).toHaveLength(2);
});

it.each(["full task", "summary"])(
  "a late missing %s cannot evict the replacement native record for the same task",
  async (read) => {
    const f = await fixture();
    await f.repository.initialize();
    const started = deferred<void>(),
      release = deferred<void>();
    const portable = String(f.record.frontmatter.id);
    let direct: Promise<unknown>;
    if (read === "summary") {
      f.find.mockImplementationOnce(async () => {
        started.resolve();
        await release.promise;
        return null;
      });
      direct = f.repository.getSummary(portable);
    } else {
      vi.spyOn(f.client, "get").mockImplementationOnce(async () => {
        started.resolve();
        await release.promise;
        throw new MdbaseError({
          code: "not_found",
          recovery: "none",
          message: "Original removed",
        });
      });
      direct = expect(f.repository.get(portable)).rejects.toThrow(
        "no longer available",
      );
    }
    await started.promise;
    f.replica.deleteElsewhere(f.id);
    seedTask(f.replica, { title: "Replacement" }, { id: portable });
    expect(await f.repository.listSummaries()).toMatchObject([
      { id: portable, title: "Replacement" },
    ]);
    release.resolve();
    await direct;
    expect(await f.repository.listSummaries()).toMatchObject([
      { id: portable, title: "Replacement" },
    ]);
    expect(f.query).toHaveBeenCalledOnce();
  },
);

it("keeps pending write status bound to a native record after its task row is removed", async () => {
  const f = await fixture();
  await f.repository.initialize();
  const portable = String(f.record.frontmatter.id);
  f.replica.deleteElsewhere(f.id);
  expect(await f.repository.listSummaries()).toEqual([]);
  const state = vi
    .spyOn(f.client.ledger, "stateOf")
    .mockImplementation((id) => (id === f.id ? "saving" : "saved"));
  expect(f.repository.writeState({ kind: "task", id: portable })).toBe(
    "pending",
  );
  const next = seedTask(f.replica, { title: "Replacement" }, { id: portable });
  expect(await f.repository.listSummaries()).toMatchObject([
    { title: "Replacement" },
  ]);
  expect(f.repository.writeState({ kind: "task", id: portable })).toBe(
    "pending",
  );
  state.mockImplementation((id) => (id === next.id ? "saving" : "saved"));
  expect(f.repository.writeState({ kind: "task", id: portable })).toBe(
    "pending",
  );
  expect(state).toHaveBeenLastCalledWith(next.id);
});

it("re-enqueues the original UUID when its acknowledgement read fails", async () => {
  const f = await nextTaskFixture({ confirmDelayMs: null });
  fixtures.push(f);
  // No further notification is owed for this acknowledgement.
  const watch = f.client.watchChanges.bind(f.client);
  vi.spyOn(f.client, "watchChanges").mockImplementation((_cb, options) =>
    watch(() => {}, options),
  );
  await f.repository.initialize();
  const task = await f.repository.create({ title: "Local result" });
  const find = vi
    .spyOn(f.client, "find")
    .mockRejectedValueOnce(new Error("ACK read interrupted"));
  const query = vi.spyOn(f.client, "query");
  f.replica.confirmAll();
  await vi.waitFor(() => expect(find).toHaveBeenCalledOnce());
  f.replica.editElsewhere(task.id, {
    frontmatter: { title: "Current result" },
  });
  expect(await f.repository.listSummaries()).toMatchObject([
    { title: "Current result" },
  ]);
  expect(find.mock.calls.map(([id]) => id)).toEqual([task.id, task.id]);
  expect(query).not.toHaveBeenCalled();
});

it("bounds concurrent finds and shares the pass and its committed notification", async () => {
  const f = await fixture();
  await f.repository.initialize();
  const ids = Array.from(
    { length: 20 },
    (_, i) => seedTask(f.replica, { title: `Added ${i}` }).id,
  );
  const release = deferred<void>();
  // Hold the first group at the client boundary, then count every read.
  let active = 0,
    maximum = 0;
  f.find.mockImplementation(async (id, options) => {
    active++;
    maximum = Math.max(maximum, active);
    try {
      await release.promise;
      return await f.findRecord(id, options);
    } finally {
      active--;
    }
  });
  const committed = vi.fn();
  const stop = f.repository.subscribe((change) => {
    if (change?.kind === "data") committed();
  });
  const reads = Promise.all([
    f.repository.listSummaries(),
    f.repository.listSummaries(),
  ]);
  await vi.waitFor(() => expect(active).toBe(8));
  committed.mockClear();
  release.resolve();
  const [rows] = await reads;
  stop();
  expect(rows).toHaveLength(21);
  expect(maximum).toBe(8);
  expect(new Set(f.taskReads().map(([id]) => id))).toEqual(new Set(ids));
  expect(f.taskReads()).toHaveLength(20);
  expect(committed).toHaveBeenCalledOnce();
});

it("protects an accepted local task write from an older remove even while its feed echo is delayed", async () => {
  const f = await nextTaskFixture();
  fixtures.push(f);
  const portableId = crypto.randomUUID();
  const { id, path } = seedTask(
    f.replica,
    { title: "Original" },
    { id: portableId },
  );
  let deliver!: Parameters<typeof f.client.watchChanges>[0];
  const watch = f.client.watchChanges.bind(f.client);
  vi.spyOn(f.client, "watchChanges").mockImplementation((cb, options) => {
    deliver = cb;
    return watch(() => {}, options);
  });
  await f.repository.initialize();
  const other = crypto.randomUUID();
  const started = deferred<void>(),
    release = deferred<void>();
  const find = f.client.find.bind(f.client);
  vi.spyOn(f.client, "find").mockImplementation(async (id, options) => {
    if (id === other) {
      started.resolve();
      await release.promise;
    }
    return find(id, options);
  });
  deliver({
    reset: false,
    cursor: "old",
    changes: [
      { id, path, kind: "remove", version: 1 },
      { id: other, path: "other.md", kind: "put", version: 1 },
    ],
  });
  const rows = f.repository.listSummaries();
  await started.promise;
  try {
    expect(
      await f.repository.update(portableId, { title: "Accepted" }),
    ).toMatchObject({ title: "Accepted" });
  } finally {
    release.resolve();
  }
  expect(await rows).toMatchObject([{ id: portableId, title: "Accepted" }]);
});
