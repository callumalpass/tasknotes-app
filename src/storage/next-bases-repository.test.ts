import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AppBasesDescriptor,
  AppBasesResult,
} from "@mdbase-dev/sdk/app-host";
import { nextTaskFixture } from "../test/next-task-fixture";
import type { TaskViewExecution } from "../domain/view";
import * as timezone from "../domain/runtime-timezone";

// Explicit native-result stand-ins. Memory fixture supplies task metadata only;
// never native execution/catalog/authority/startup or actual WASM proof.
const fixtures: Awaited<ReturnType<typeof nextTaskFixture>>[] = [];
afterEach(() => {
  fixtures.splice(0).forEach((f) => f.close());
  vi.restoreAllMocks();
});
const clock = { instant: 1, tz: "UTC", localDate: "1970-01-01" };
const revision = "sha256:" + "ab".repeat(32);
const descriptor: AppBasesDescriptor = {
  record: "00000000-0000-0000-0000-000000000001",
  sourceRevision: revision,
  path: "tasks.base",
  ordinal: 1,
  name: "Same",
  viewType: "tasknotesTaskList",
  implementations: [],
};
async function fixture() {
  const f = await nextTaskFixture();
  fixtures.push(f);
  const task = await f.repository.create({ title: "Native-selected task" });
  // This suite isolates native selection/metadata ordering, not ACK races.
  // Local capture now returns before ACK: establish a stable seed frontier.
  f.replica.confirmAll();
  await vi.waitFor(async () =>
    expect(await f.client.pendingWrites()).toEqual([]),
  );
  const record = (await f.client.query({ types: ["task"], limit: 10 }))
    .records[0]!;
  const genericList = vi.spyOn(f.client.views, "list");
  const genericExecute = vi.spyOn(f.client.views, "execute");
  const genericSource = vi.spyOn(f.client.views, "readSource");
  const list = vi.spyOn(f.client, "listAppBasesViews").mockResolvedValue({
    kind: "success",
    views: [descriptor],
    clock,
    collectionRevision: revision,
    continuation: null,
  });
  const source = vi
    .spyOn(f.client, "readAppBasesViewSource")
    .mockResolvedValue({
      kind: "success",
      view: descriptor,
      clock,
      collectionRevision: revision,
      source:
        "views:\n  - name: Same\n    type: table\n  - name: Same\n    type: tasknotesTaskList\n    options:\n      sections: day\n",
    });
  const reply: Extract<AppBasesResult, { kind: "success" }> = {
    kind: "success",
    view: descriptor,
    columns: ["note.title"],
    unavailableColumns: [],
    rows: [
      {
        record: record.id,
        path: record.path,
        sourceRevision: record.revision,
        cells: [{ kind: "text", value: "Native cell" }],
      },
    ],
    groups: [],
    clock,
    collectionRevision: revision,
  };
  const execute = vi
    .spyOn(f.client, "executeAppBases")
    .mockResolvedValue(reply);
  const view = (await f.repository.listViews())[0]!.views[0]!;
  return {
    ...f,
    task,
    record,
    list,
    source,
    execute,
    reply,
    view,
    genericList,
    genericExecute,
    genericSource,
  };
}

describe("native saved-view adapter sequencing (stand-ins only)", () => {
  it("retains a detached display-only execution for first paint without another native read", async () => {
    const f = await fixture();
    expect(await f.repository.cachedViewExecution(f.view)).toBeNull();
    const result = await f.repository.executeView(f.view);
    result.rows[0]!.values["note.title"] = "caller changed result";
    f.execute.mockClear();
    f.source.mockClear();
    const cached = await f.repository.cachedViewExecution(f.view);
    expect(cached).toMatchObject({ stale: true, totalCount: 1 });
    expect(cached!.rows[0]!.values["note.title"]).toBe("Native cell");
    cached!.rows[0]!.values["note.title"] = "caller changed cache";
    expect(
      (await f.repository.cachedViewExecution(f.view))!.rows[0]!.values[
        "note.title"
      ],
    ).toBe("Native cell");
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.source).not.toHaveBeenCalled();
  });
  it("does not reuse cached rows for changed source identity, view metadata or timezone", async () => {
    const f = await fixture();
    await f.repository.executeView(f.view);
    for (const changed of [
      {
        ...f.view,
        source: { ...f.view.source, revision: "sha256:" + "cd".repeat(32) },
      },
      { ...f.view, id: "2" },
      { ...f.view, name: "Another view" },
    ])
      expect(await f.repository.cachedViewExecution(changed)).toBeNull();
    const original = timezone.runtimeTimezone();
    vi.spyOn(timezone, "runtimeTimezone").mockReturnValue(
      original === "UTC" ? "Australia/Sydney" : "UTC",
    );
    expect(await f.repository.cachedViewExecution(f.view)).toBeNull();
  });
  it("clears remembered executions on writes and refuses reads from suspended or disposed owners", async () => {
    const f = await fixture();
    await f.repository.executeView(f.view);
    f.repository.suspend();
    await expect(f.repository.cachedViewExecution(f.view)).rejects.toThrow();
    f.repository.resume();
    expect(await f.repository.cachedViewExecution(f.view)).toMatchObject({
      stale: true,
    });
    await f.repository.create({ title: "Invalidate cached rows" });
    expect(await f.repository.cachedViewExecution(f.view)).toBeNull();
    f.repository.dispose();
    await expect(f.repository.cachedViewExecution(f.view)).rejects.toThrow();
  });
  it("cannot repopulate the cache with an execution invalidated while loading", async () => {
    const f = await fixture();
    let release!: (reply: typeof f.reply) => void;
    f.execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = f.repository.executeView(f.view);
    const rejected = expect(pending).rejects.toMatchObject({
      reason: "collection_changed",
    });
    await vi.waitFor(() => expect(f.execute).toHaveBeenCalledOnce());
    await f.repository.create({ title: "Concurrent change" });
    release(f.reply);
    await rejected;
    expect(await f.repository.cachedViewExecution(f.view)).toBeNull();
  });
  it("a slower earlier execution cannot replace a newer cached execution", async () => {
    const f = await fixture();
    let release!: (reply: typeof f.reply) => void;
    f.execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const older = f.repository.executeView(f.view);
    await vi.waitFor(() => expect(f.execute).toHaveBeenCalledOnce());
    f.execute.mockResolvedValueOnce({
      ...f.reply,
      rows: [
        { ...f.reply.rows[0]!, cells: [{ kind: "text", value: "Newer cell" }] },
      ],
    });
    await f.repository.executeView(f.view);
    release(f.reply);
    await older;
    expect(
      (await f.repository.cachedViewExecution(f.view))!.rows[0]!.values[
        "note.title"
      ],
    ).toBe("Newer cell");
  });
  it("uses original UUID/SHA/ordinal and selected metadata READ without generic fallback", async () => {
    const f = await fixture();
    const get = vi.spyOn(f.client, "get");
    const result = await f.repository.executeView(f.view);
    expect(result.totalCount).toBe(1);
    expect(result.hasMore).toBe(false);
    expect(result.rows[0]!.task.id).toBe(f.task.id);
    expect(result.rows[0]!.values).toEqual({ "note.title": "Native cell" });
    expect(f.execute.mock.calls[0]![0]).toMatchObject({
      record: descriptor.record,
      sourceRevision: revision,
      ordinal: 1,
      hints: new Map(),
    });
    expect(f.execute.mock.calls[0]![0].window).toBeUndefined();
    expect(f.source.mock.calls[0]![0]).toMatchObject({
      record: descriptor.record,
      sourceRevision: revision,
      ordinal: 1,
    });
    expect(get.mock.calls.map(([id]) => id)).toEqual([f.record.id]);
    expect(f.genericList).not.toHaveBeenCalled();
    expect(f.genericExecute).not.toHaveBeenCalled();
    expect(f.genericSource).not.toHaveBeenCalled();
  });
  it("rejects missing/wrong source identities without guessing from path or name", async () => {
    const f = await fixture();
    await expect(
      f.repository.executeView({ ...f.view, id: "0" }),
    ).rejects.toMatchObject({ reason: "unsupported" });
    expect(f.execute).not.toHaveBeenCalled();
    f.execute.mockResolvedValue({
      ...f.reply,
      view: { ...descriptor, ordinal: 0 },
    });
    await expect(f.repository.executeView(f.view)).rejects.toThrow(
      "source identity",
    );
  });
  it("publishes the producer's exact declaration selector and source record identity", async () => {
    const f = await fixture();
    expect(f.view.declaration).toEqual({
      recordId: descriptor.record,
      path: descriptor.path,
      revision,
      ordinal: descriptor.ordinal,
      name: descriptor.name,
    });
    expect((await f.repository.readViewSource(descriptor.path)).recordId).toBe(
      descriptor.record,
    );
    expect(f.genericSource).not.toHaveBeenCalled();
  });
  it("refuses a changed declaration selector before source READ or execution", async () => {
    const f = await fixture();
    f.source.mockClear();
    await expect(
      f.repository.executeView({
        ...f.view,
        declaration: { ...f.view.declaration!, ordinal: 0 },
      }),
    ).rejects.toMatchObject({ reason: "unsupported" });
    expect(f.source).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("rediscovers the exact declaration after an accepted write invalidates the catalog", async () => {
    const f = await fixture();
    const added = await f.repository.create({ title: "Confirmed new task" });
    await vi.waitFor(async () =>
      expect(await f.repository.cachedViews()).toEqual([]),
    );
    const record = (
      await f.client.query({ types: ["task"], limit: 10 })
    ).records.find(
      (candidate) => candidate.frontmatter.get("id") === added.id,
    )!;
    f.execute.mockResolvedValue({
      ...f.reply,
      rows: [
        ...f.reply.rows,
        {
          record: record.id,
          path: record.path,
          sourceRevision: record.revision,
          cells: [{ kind: "text", value: "Confirmed new task" }],
        },
      ],
    });
    const result = await f.repository.executeView(f.view);
    expect(result.rows.map((row) => row.task.id)).toEqual([
      f.task.id,
      added.id,
    ]);
    expect(f.list).toHaveBeenCalledTimes(2);
    expect(f.execute.mock.calls[0]![0]).toMatchObject({
      record: descriptor.record,
      sourceRevision: revision,
      ordinal: descriptor.ordinal,
    });
    expect(f.genericExecute).not.toHaveBeenCalled();
  });
  it.each(["revision", "path", "missing"] as const)(
    "refuses a %s declaration after rediscovery instead of silently reselecting it",
    async (drift) => {
      const f = await fixture();
      await f.repository.create({ title: "Invalidate the original catalog" });
      await vi.waitFor(async () =>
        expect(await f.repository.cachedViews()).toEqual([]),
      );
      f.list.mockResolvedValue({
        kind: "success",
        views:
          drift === "missing"
            ? []
            : [
                {
                  ...descriptor,
                  ...(drift === "revision"
                    ? { sourceRevision: "sha256:" + "cd".repeat(32) }
                    : { path: "moved.base" }),
                },
              ],
        clock,
        collectionRevision: revision,
        continuation: null,
      });
      f.source.mockClear();
      await expect(f.repository.executeView(f.view)).rejects.toMatchObject({
        reason: "unsupported",
      });
      expect(f.source).not.toHaveBeenCalled();
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
  it("full-load iteration replaces the independent prefix with ONE complete execution", async () => {
    const f = await fixture();
    const window = {
      offset: 0,
      limit: 200,
      totalMatchedRows: 201,
      groupPlacements: [],
    };
    // A protocol-valid 200-row window, using selected metadata identities.
    // Duplicate/native grammar checks remain SDK/native; mock distinct IDs here.
    const rows = Array.from({ length: 200 }, (_, i) => ({
      ...f.reply.rows[0]!,
      record: `00000000-0000-0000-0000-${(i + 10).toString(16).padStart(12, "0")}`,
      path: `mock-${i}.md`,
    }));
    vi.spyOn(f.client, "get").mockImplementation(async (id) => {
      const row = rows.find((r) => r.record === id);
      return row ? { ...f.record, id: row.record, path: row.path } : f.record;
    });
    f.execute
      .mockResolvedValueOnce({ ...f.reply, rows, window })
      .mockResolvedValueOnce(f.reply);
    const pages = f.repository.iterateView(f.view, { cumulative: true });
    const iterator = pages[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.value!.hasMore).toBe(true);
    const full = await iterator.next();
    expect(full.value!.hasMore).toBe(false);
    expect(full.value!.totalCount).toBe(1);
    expect(full.value!.records).toHaveLength(1);
    expect(f.execute.mock.calls[0]![0].window).toEqual({
      offset: 0,
      limit: 200,
    });
    expect(f.execute.mock.calls[1]![0].window).toBeUndefined();
    expect((await iterator.next()).done).toBe(true);
  });
  it("continues empty progress before publishing a complete native inventory", async () => {
    const f = await fixture();
    f.list
      .mockClear()
      .mockResolvedValueOnce({
        kind: "success",
        views: [],
        clock,
        collectionRevision: revision,
        continuation: new Uint8Array(32).fill(1),
      })
      .mockResolvedValueOnce({
        kind: "success",
        views: [descriptor],
        clock,
        collectionRevision: revision,
        continuation: null,
      });
    const catalog = await f.repository.listViews();
    expect(f.list).toHaveBeenCalledTimes(2);
    expect(f.list.mock.calls[1]![0].continuation).toEqual(
      new Uint8Array(32).fill(1),
    );
    expect(catalog[0]!.views[0]!.id).toBe("1");
    expect(f.genericList).not.toHaveBeenCalled();
  });
  it("does not publish a partial catalog after captured-cut drift", async () => {
    const f = await fixture();
    const before = await f.repository.cachedViews();
    f.list
      .mockResolvedValueOnce({
        kind: "success",
        views: [{ ...descriptor, ordinal: 2 }],
        clock,
        collectionRevision: revision,
        continuation: new Uint8Array(32).fill(1),
      })
      .mockResolvedValueOnce({
        kind: "success",
        views: [],
        clock: { ...clock, instant: 2 },
        collectionRevision: revision,
        continuation: null,
      });
    await expect(f.repository.listViews()).rejects.toThrow("captured cut");
    expect(await f.repository.cachedViews()).toEqual(before);
    await expect(
      f.repository.executeView({
        ...f.view,
        id: "2",
        key: f.view.key.replace(/1$/, "2"),
      }),
    ).rejects.toMatchObject({ reason: "unsupported" });
  });
  it("uses global native group counts for the selected window, not hydrated length", async () => {
    const f = await fixture();
    const rows = Array.from({ length: 200 }, (_, i) => ({
      ...f.reply.rows[0]!,
      record: `00000000-0000-4000-8000-${(i + 10).toString(16).padStart(12, "0")}`,
      path: `mock-${i}.md`,
    }));
    vi.spyOn(f.client, "get").mockImplementation(async (id) => {
      const row = rows.find((r) => r.record === id)!;
      return {
        ...f.record,
        id: row.record,
        path: row.path,
        frontmatter: new Map([...f.record.frontmatter, ["id", row.record]]),
      };
    });
    f.source.mockResolvedValue({
      kind: "success",
      view: descriptor,
      clock,
      collectionRevision: revision,
      source:
        "views:\n  - name: Same\n  - name: Same\n    type: tasknotesTaskList\n    groupBy:\n      property: note.status\n",
    });
    f.execute.mockResolvedValue({
      ...f.reply,
      rows,
      groups: [
        {
          key: { kind: "text", value: "open" },
          rowIndices: rows.map((_, i) => i),
        },
      ],
      window: {
        offset: 0,
        limit: 200,
        totalMatchedRows: 1000,
        groupPlacements: [
          {
            globalGroupOrdinal: 0,
            totalGroupRows: 999,
            rowOrdinals: rows.map((_, i) => i),
          },
        ],
      },
    });
    const pages = f.repository.iterateView(f.view, { cumulative: true });
    const iterator = pages[Symbol.asyncIterator]();
    const page = (await iterator.next()).value! as TaskViewExecution;
    expect(page.records).toHaveLength(200);
    expect(
      page.records!.every(({ values }) => values["note.status"] === "open"),
    ).toBe(true);
    expect(
      page.rows.every(({ values }) => values["note.status"] === "open"),
    ).toBe(true);
    expect(page.totalCount).toBe(1000);
    expect(page.hasMore).toBe(true);
    expect(page.groups).toEqual([
      { values: { "note.status": "open" }, count: 999, summaries: {} },
    ]);
    await iterator.return?.();
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it("retains native order even when selected metadata reads complete out of order", async () => {
    const f = await fixture();
    const second = {
      ...f.reply.rows[0]!,
      record: "00000000-0000-4000-8000-000000000002",
      path: "second.md",
      cells: [{ kind: "text" as const, value: "Second native cell" }],
    };
    f.execute.mockResolvedValue({
      ...f.reply,
      rows: [f.reply.rows[0]!, second],
    });
    vi.spyOn(f.client, "get").mockImplementation(async (id) => {
      if (id === f.record.id) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return f.record;
      }
      return {
        ...f.record,
        id: second.record,
        path: second.path,
        frontmatter: new Map([...f.record.frontmatter, ["id", second.record]]),
      };
    });
    const result = await f.repository.executeView(f.view);
    expect(result.records!.map(({ record }) => record.path)).toEqual([
      f.record.path,
      second.path,
    ]);
    expect(result.rows.map((row) => row.values["note.title"])).toEqual([
      "Native cell",
      "Second native cell",
    ]);
  });
  it("propagates native refusal and pre-cancellation without fallback or hydration", async () => {
    const f = await fixture();
    const get = vi.spyOn(f.client, "get");
    f.execute.mockResolvedValue({
      kind: "refusal",
      problem: {
        code: "conflict",
        recovery: "refresh",
        reason: "source_changed",
        message: "Native source changed",
      },
    });
    await expect(f.repository.executeView(f.view)).rejects.toMatchObject({
      reason: "source_changed",
    });
    expect(get).not.toHaveBeenCalled();
    expect(f.genericExecute).not.toHaveBeenCalled();
    f.source.mockClear();
    f.execute.mockClear();
    const controller = new AbortController();
    controller.abort();
    const pages = f.repository.iterateView(f.view, {
      cumulative: true,
      signal: controller.signal,
    });
    const iterator = pages[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(f.source).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("reads exact source without a generic source endpoint", async () => {
    const f = await fixture();
    expect((await f.repository.readViewSource(descriptor.path)).revision).toBe(
      revision,
    );
    expect(f.genericSource).not.toHaveBeenCalled();
  });
});
