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
  it("reads exact source without a generic source endpoint", async () => {
    const f = await fixture();
    expect((await f.repository.readViewSource(descriptor.path)).revision).toBe(
      revision,
    );
    expect(f.genericSource).not.toHaveBeenCalled();
  });
});
