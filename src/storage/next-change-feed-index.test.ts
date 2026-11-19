import { MdbaseError, type wire } from "@mdbase-dev/sdk";
import {
  parseFrontmatter,
  serializeMarkdownDocument,
} from "@tasknotes/model/frontmatter";
import { afterEach, expect, it, vi } from "vitest";
import {
  nextTaskFixture,
  seedRecord,
  seedTask,
} from "../test/next-task-fixture";
import { deferred } from "../test/deferred";

const fixtures: Awaited<ReturnType<typeof nextTaskFixture>>[] = [];
afterEach(() => {
  fixtures.splice(0).forEach((f) => f.close());
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function fixture(withCursor = false, manual = false) {
  const f = await nextTaskFixture(manual ? { confirmDelayMs: null } : {});
  fixtures.push(f);
  const { id } = seedTask(f.replica, { title: "Original" });
  const record = await f.client.get(id, { include: { effective: true } });
  const watch = f.client.watchChanges.bind(f.client);
  let deliver!: Parameters<typeof watch>[0];
  let lastBatch: wire.ChangesResult | undefined;
  const watches = vi
    .spyOn(f.client, "watchChanges")
    .mockImplementation((cb, options) => {
      let cursor = options?.cursor ?? "0";
      deliver = (batch) => {
        lastBatch = batch;
        cursor = batch.cursor;
        cb(batch);
      };
      const original = watch(manual ? () => {} : deliver, options);
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
    lastBatch: () => lastBatch,
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
    const other = seedTask(f.replica, { title: "Unrelated" });
    await (
      await f.client.update(f.record, { patch: { title: "Before suspend" } })
    ).confirmed;
    await f.repository.listSummaries();
    expect(f.lastBatch()?.changes.map(({ id }) => id)).toContain(f.id);
    const stoppedCursor = f.lastBatch()!.cursor;
    f.repository.suspend();
    await (
      await f.client.update(f.id, { patch: { title: "While suspended" } })
    ).confirmed;
    f.query.mockClear();
    f.find.mockClear();
    f.repository.resume();
    expect(await f.repository.refresh()).toMatchObject({
      scanned: withCursor ? 1 : 2,
    });
    expect(
      (await f.repository.listSummaries()).map((task) => task.title),
    ).toEqual(expect.arrayContaining(["While suspended", "Unrelated"]));
    expect(f.watches.mock.calls[1]?.[1]?.cursor).toEqual(
      withCursor ? stoppedCursor : undefined,
    );
    expect(f.query).toHaveBeenCalledTimes(withCursor ? 0 : 1);
    expect(f.taskReads().map(([id]) => id)).toEqual(withCursor ? [f.id] : []);
    expect(f.taskReads().map(([id]) => id)).not.toContain(other.id);
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
      expect(await direct).toBeNull();
    }
    expect(await f.repository.listSummaries()).toMatchObject([
      { id: newId, title: "New identity" },
    ]);
    release.resolve();
    expect(await direct).toBeNull();
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

it("publishes a replacement at the path of a missing task during a reset scan", async () => {
  const f = await fixture();
  await f.repository.initialize();
  f.replica.deleteElsewhere(f.id);
  const replacement = seedTask(
    f.replica,
    { title: "Replacement" },
    { path: f.record.path },
  );
  const record = await f.client.get(replacement.id, {
    include: { effective: true },
  });
  f.push([], true);
  const started = deferred<void>(),
    release = deferred<void>();
  f.query.mockImplementationOnce(async () => {
    started.resolve();
    await release.promise;
    return { records: [record], complete: true, asOf: 1 };
  });
  const rows = f.repository.listSummaries();
  await started.promise;
  try {
    await expect(
      f.repository.update(String(f.record.frontmatter.id), {
        title: "Missing",
      }),
    ).rejects.toThrow("no longer available");
  } finally {
    release.resolve();
  }
  expect(await rows).toMatchObject([{ title: "Replacement" }]);
  expect(await f.repository.refresh()).toMatchObject({ scanned: 0 });
  expect(await f.repository.listSummaries()).toMatchObject([
    { title: "Replacement" },
  ]);
});

it("returns the revision read for Undo rather than the cached revision", async () => {
  const f = await fixture();
  await (
    await f.client.update(f.id, { patch: { mobileRevision: 7 } })
  ).confirmed;
  await f.repository.initialize();
  const started = deferred<void>(),
    release = deferred<void>();
  f.find.mockImplementationOnce(async (...args) => {
    started.resolve();
    await release.promise;
    return f.findRecord(...args);
  });
  const direct = f.repository.getSummary(String(f.record.frontmatter.id));
  await started.promise;
  await (
    await f.client.update(f.id, { patch: { mobileRevision: 8 } })
  ).confirmed;
  release.resolve();
  expect(await direct).toMatchObject({ revision: 8 });
});

it("reconciles a confirmed read superseded by an older pending delta", async () => {
  const f = await fixture(false, true);
  await f.repository.initialize();
  const intent = {
    id: crypto.randomUUID(),
    authorityRequestId: undefined as string | undefined,
  };
  const local = await f.repository.create({ title: "Local" }, intent);
  f.push([{ ...f.change, id: local.id, path: local.path }]);
  const deltaStarted = deferred<void>(),
    releaseDelta = deferred<void>();
  const ackStarted = deferred<void>(),
    releaseAck = deferred<void>();
  f.find
    .mockImplementationOnce(async (...args) => {
      const record = await f.findRecord(...args);
      deltaStarted.resolve();
      await releaseDelta.promise;
      return record;
    })
    .mockImplementationOnce(async (...args) => {
      const record = await f.findRecord(...args);
      ackStarted.resolve();
      await releaseAck.promise;
      return record;
    });
  const older = f.repository.listSummaries();
  await deltaStarted.promise;
  f.replica.confirmAll();
  f.replica.editElsewhere(local.id, { frontmatter: { title: "Confirmed" } });
  await ackStarted.promise;
  releaseDelta.resolve();
  await older;
  releaseAck.resolve();
  await vi.waitFor(() => expect(intent.authorityRequestId).toBeUndefined());
  expect(await f.repository.listSummaries()).toContainEqual(
    expect.objectContaining({ title: "Confirmed" }),
  );
});

it("keeps every unread UUID pending after a multi-record ACK fails", async () => {
  vi.setSystemTime(new Date("2026-08-05T10:00:00Z"));
  const f = await fixture(false, true);
  await f.repository.initialize();
  const parent = await f.repository.create({
    title: "Rolling",
    scheduled: "2026-08-05",
    recurrence: "FREQ=DAILY;INTERVAL=1;DTSTART=20260805",
    occurrenceMaterialization: "rolling",
    occurrencePastHorizon: "P0D",
    occurrenceFutureHorizon: "P1D",
  });
  const children = (await f.repository.listSummaries()).filter(
    (task) => task.occurrenceDate,
  );
  expect(children).toHaveLength(2);
  f.find.mockClear().mockRejectedValueOnce(new Error("first ACK read failed"));
  f.replica.confirmAll();
  await vi.waitFor(() => expect(f.find).toHaveBeenCalled());
  for (const child of children)
    f.replica.editElsewhere(child.id, {
      frontmatter: { title: "Child confirmed" },
    });
  expect(
    (await f.repository.listSummaries()).filter(
      (task) => task.title === "Child confirmed",
    ),
  ).toHaveLength(2);
  expect(f.taskReads()[0]?.[0]).toBe(parent.id);
});

it.each([false, true])(
  "delivers a captured write ACK after resume (cursor: %s)",
  async (withCursor) => {
    const f = await fixture(withCursor, true);
    await f.repository.initialize();
    const captured = await f.repository.create({ title: "Before suspend" });
    f.repository.suspend();
    f.repository.resume();
    await f.repository.refresh();
    f.replica.confirmAll();
    f.replica.editElsewhere(captured.id, {
      frontmatter: { title: "After resume" },
    });
    await vi.waitFor(async () =>
      expect(await f.repository.listSummaries()).toContainEqual(
        expect.objectContaining({ title: "After resume" }),
      ),
    );
  },
);

it("does not archive with settings retired during the task read", async () => {
  const f = await fixture();
  const path = "_mdbase/settings/dev.tasknotes.md";
  const settings = seedRecord(f.replica, {
    path,
    types: ["tasknotes-settings"],
    frontmatter: {
      app: "dev.tasknotes",
      scope: "collection",
      settings_version: 1,
      archive_folder: "Old",
      move_on_archive: true,
    },
  });
  await f.repository.initialize();
  expect((await f.repository.taskConfiguration()).archive.folder).toBe("Old");
  const started = deferred<void>(),
    release = deferred<void>();
  const get = f.client.get.bind(f.client);
  vi.spyOn(f.client, "get").mockImplementationOnce(async (...args) => {
    started.resolve();
    await release.promise;
    return get(...args);
  });
  const archived = f.repository.setArchived(
    String(f.record.frontmatter.id),
    true,
  );
  await started.promise;
  await (
    await f.client.update(settings.id, { patch: { archive_folder: "New" } })
  ).confirmed;
  release.resolve();
  expect((await archived).path).toMatch(/^New\//);
});

it("rescans when a revisionless task definition changes only its match glob", async () => {
  const f = await fixture();
  await f.repository.initialize();
  const path = "_types/task.md";
  const source = parseFrontmatter((await f.client.resources.get(path)).text!);
  f.replica.seedResource(
    path,
    serializeMarkdownDocument(
      { ...source.frontmatter, match: { path_glob: "elsewhere/*.md" } },
      source.body,
    ),
  );
  f.query
    .mockClear()
    .mockResolvedValueOnce({ records: [], complete: true, asOf: 1 });
  expect(await f.repository.refresh()).toMatchObject({ removed: 1 });
  expect(f.query).toHaveBeenCalledOnce();
});

it("invalidates empty discovery for an unknown untyped view source", async () => {
  const f = await fixture();
  await f.repository.initialize();
  const discovery = vi.spyOn(f.client, "listAppBasesViews");
  expect(await f.repository.listViews()).toEqual([]);
  f.push([
    {
      id: crypto.randomUUID(),
      path: "boards/team.md",
      entity: "record",
      kind: "put",
      version: 2,
    },
  ]);
  await f.repository.listViews();
  expect(discovery).toHaveBeenCalledTimes(2);
});

it("notifies views once when an unchanged refresh crosses local midnight", async () => {
  vi.setSystemTime(new Date(2026, 7, 5, 23, 59));
  const f = await fixture(false, true);
  await f.repository.initialize();
  const changed = vi.fn();
  f.repository.subscribe(changed);
  await f.repository.refresh();
  expect(changed).not.toHaveBeenCalledWith({ kind: "data" });
  vi.setSystemTime(new Date(2026, 7, 6, 0, 1));
  await f.repository.refresh();
  expect(changed).toHaveBeenCalledWith({ kind: "data" });
  changed.mockClear();
  await f.repository.refresh();
  expect(changed).not.toHaveBeenCalledWith({ kind: "data" });
});

it("bounds each reader's delta passes during continuous edits", async () => {
  const f = await fixture();
  await f.repository.initialize();
  f.push([f.change]);
  let reads = 0;
  f.find.mockImplementation(async (...args) => {
    if (++reads > 3) throw new Error("reader chased the edit stream");
    f.push([f.change]);
    return f.findRecord(...args);
  });
  expect(await f.repository.listSummaries()).toHaveLength(1);
  f.find.mockClear().mockImplementation(f.findRecord);
  await f.repository.listSummaries();
  expect(f.find).toHaveBeenCalledOnce();
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
