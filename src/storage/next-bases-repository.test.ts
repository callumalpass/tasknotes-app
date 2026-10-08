import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AppBasesDescriptor,
  AppBasesResult,
} from "@mdbase-dev/sdk/app-host";
import { nextTaskFixture } from "../test/next-task-fixture";

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
    const page = (await iterator.next()).value!;
    expect(page.records).toHaveLength(200);
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
