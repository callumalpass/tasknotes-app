import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppBasesDescriptor } from "@mdbase-dev/sdk/app-host";
import { nextTaskFixture } from "../test/next-task-fixture";
import { ensureTaskNotesDefaultViewSource } from "../application/ensure-default-view-source";

// Protocol stand-ins only: source replies are mocked, CRUD uses the SDK test
// replica. These tests do not prove native READ, grants, startup or rendering.
const fixtures: Awaited<ReturnType<typeof nextTaskFixture>>[] = [];
afterEach(() => {
  fixtures.splice(0).forEach((fixture) => fixture.close());
  vi.restoreAllMocks();
});
const document = "views:\n  - name: Tasks\n    type: tasknotesTaskList\n";
const changed = "views:\n  - name: Changed\n    type: tasknotesTaskList\n";
const clock = { instant: 1, tz: "UTC", localDate: "1970-01-01" };
async function fixture(options: Parameters<typeof nextTaskFixture>[0] = {}) {
  const f = await nextTaskFixture(options);
  fixtures.push(f);
  const seeded = f.replica.seed({ path: "tasks.base", body: document });
  const record = await f.client.get(seeded.id, { document: true });
  const descriptor: AppBasesDescriptor = {
    record: record.id,
    sourceRevision: record.revision,
    path: record.path,
    ordinal: 0,
    name: "Tasks",
    viewType: "tasknotesTaskList",
    implementations: [],
  };
  const list = vi.spyOn(f.client, "listAppBasesViews").mockResolvedValue({
    kind: "success",
    views: [descriptor],
    clock,
    collectionRevision: record.revision,
    continuation: null,
  });
  const source = vi
    .spyOn(f.client, "readAppBasesViewSource")
    .mockResolvedValue({
      kind: "success",
      view: descriptor,
      source: document,
      clock,
      collectionRevision: record.revision,
    });
  const generic = vi.spyOn(f.client.views, "readSource");
  await f.repository.listViews();
  return { ...f, record, descriptor, list, source, generic };
}

describe("native view source boundaries (protocol stand-ins)", () => {
  it("does not seed defaults during navigation, even with an owner grant", async () => {
    const f = await fixture();
    const create = vi.spyOn(f.client, "create");
    const createSource = vi.spyOn(f.repository, "createViewSource");
    const documents: Awaited<ReturnType<typeof f.repository.listViews>> = [];
    expect(
      await ensureTaskNotesDefaultViewSource(
        f.repository,
        documents,
        await f.repository.taskConfiguration(),
      ),
    ).toBe(documents);
    expect(create).not.toHaveBeenCalled();
    expect(createSource).not.toHaveBeenCalled();
  });
  it("keeps explicit creation unavailable without submitting or generic source reads", async () => {
    const f = await fixture();
    const create = vi.spyOn(f.client, "create");
    await expect(
      f.repository.createViewSource({ path: "new.base", document }),
    ).rejects.toMatchObject({ reason: "unsupported" });
    expect(create).not.toHaveBeenCalled();
    expect(f.generic).not.toHaveBeenCalled();
  });
  it.each(["record", "sourceRevision", "ordinal", "path"] as const)(
    "rejects a mismatching native READ %s before editing",
    async (field) => {
      const f = await fixture();
      const bad = {
        ...f.descriptor,
        [field]: field === "ordinal" ? 1 : "different",
      };
      f.source.mockResolvedValue({
        kind: "success",
        view: bad,
        source: document,
        clock,
        collectionRevision: f.record.revision,
      });
      const replace = vi.spyOn(f.client, "replaceDocument");
      await expect(
        f.repository.updateViewSource({
          path: f.record.path,
          document: changed,
        }),
      ).rejects.toThrow("source identity");
      expect(replace).not.toHaveBeenCalled();
      expect(f.generic).not.toHaveBeenCalled();
    },
  );
  it.each([
    { role: "viewer" as const },
    { capabilities: ["collection.read"] },
    { capabilities: ["records.edit", "records.delete"] },
  ])(
    "refuses source writes without an explicit suitable grant: %j",
    async (options) => {
      const f = await fixture(options);
      const replace = vi.spyOn(f.client, "replaceDocument");
      const remove = vi.spyOn(f.client, "delete");
      await expect(
        f.repository.updateViewSource({
          path: f.record.path,
          document: changed,
        }),
      ).rejects.toMatchObject({ reason: "unsupported" });
      await expect(
        f.repository.deleteViewSource(f.record.path),
      ).rejects.toMatchObject({ reason: "unsupported" });
      expect(f.source).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    },
  );
  it("refuses folder-scoped writes rather than inventing namespace authority", async () => {
    const f = await fixture();
    f.client.hello.grant.fileFolders = ["tasks"];
    const replace = vi.spyOn(f.client, "replaceDocument");
    await expect(
      f.repository.updateViewSource({ path: f.record.path, document: changed }),
    ).rejects.toMatchObject({ reason: "unsupported" });
    expect(replace).not.toHaveBeenCalled();
  });
  it("refuses absent or ambiguous native identities without path-based RPC", async () => {
    const f = await fixture();
    const replace = vi.spyOn(f.client, "replaceDocument");
    await expect(
      f.repository.updateViewSource({
        path: "missing.base",
        document: changed,
      }),
    ).rejects.toMatchObject({ reason: "unsupported" });
    f.list.mockResolvedValue({
      kind: "success",
      views: [
        { ...f.descriptor, record: "00000000-0000-0000-0000-000000000002" },
        f.descriptor,
      ],
      clock,
      collectionRevision: f.record.revision,
      continuation: null,
    });
    await f.repository.listViews();
    await expect(f.repository.deleteViewSource(f.record.path)).rejects.toThrow(
      "ambiguous",
    );
    expect(replace).not.toHaveBeenCalled();
    expect(f.generic).not.toHaveBeenCalled();
  });
  it("refuses stale CAS before edit or delete submission", async () => {
    const f = await fixture();
    const replace = vi.spyOn(f.client, "replaceDocument");
    const remove = vi.spyOn(f.client, "delete");
    await expect(
      f.repository.updateViewSource({
        path: f.record.path,
        document: changed,
        ifRevision: "stale",
      }),
    ).rejects.toThrow("changed");
    await expect(
      f.repository.deleteViewSource(f.record.path, "stale"),
    ).rejects.toThrow("changed");
    expect(replace).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
  it("edits only the native UUID with READ revision CAS and confirms exact document GET", async () => {
    const f = await fixture();
    const replace = vi.spyOn(f.client, "replaceDocument");
    const get = vi.spyOn(f.client, "get");
    const result = await f.repository.updateViewSource({
      path: f.record.path,
      document: changed,
    });
    expect(replace).toHaveBeenCalledWith(
      f.record,
      changed,
      expect.objectContaining({
        ifRevision: f.record.revision,
        mutationId: expect.any(String),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(get).toHaveBeenCalledWith(
      f.record.id,
      { document: true },
      expect.any(AbortSignal),
    );
    expect(result.document).toBe(changed);
    expect(result.revision).not.toBe(f.record.revision);
    expect(await f.repository.cachedViews()).toEqual([]);
    await expect(
      f.repository.readViewSource(f.record.path),
    ).rejects.toMatchObject({ reason: "unsupported" });
    expect(f.generic).not.toHaveBeenCalled();
  });
  it("retains the accepted mutation and original UUID when confirmation GET fails", async () => {
    const f = await fixture();
    const replace = vi.spyOn(f.client, "replaceDocument");
    const get = vi
      .spyOn(f.client, "get")
      .mockResolvedValueOnce(f.record)
      .mockRejectedValueOnce(new Error("READ unavailable"));
    const input = { path: f.record.path, document: changed };
    await expect(f.repository.updateViewSource(input)).rejects.toMatchObject({
      problem: {
        code: "operation_outcome_unknown",
        operation_outcome: "unknown",
      },
      cause: { message: "READ unavailable" },
    });
    expect((await f.repository.updateViewSource(input)).document).toBe(changed);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(f.source).toHaveBeenCalledTimes(1);
    expect(get.mock.calls.map(([id]) => id)).toEqual([
      f.record.id,
      f.record.id,
      f.record.id,
    ]);
  });
  it("does not report success for a confirmation document that changed after admission", async () => {
    const f = await fixture();
    const replace = vi.spyOn(f.client, "replaceDocument");
    const get = f.client.get.bind(f.client);
    vi.spyOn(f.client, "get")
      .mockResolvedValueOnce(f.record)
      .mockImplementation(async (...args) => ({
        ...(await get(...args)),
        document: "different source",
      }));
    await expect(
      f.repository.updateViewSource({ path: f.record.path, document: changed }),
    ).rejects.toMatchObject({
      problem: {
        code: "operation_outcome_unknown",
        operation_outcome: "unknown",
      },
    });
    await expect(
      f.repository.updateViewSource({ path: f.record.path, document: changed }),
    ).rejects.toMatchObject({
      problem: {
        code: "operation_outcome_unknown",
        operation_outcome: "unknown",
      },
    });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(await f.repository.cachedViews()).toEqual([]);
  });
  it.each(["id", "path", "revision", "document", "state"] as const)(
    "refuses a mismatching complete record %s before submission",
    async (field) => {
      const f = await fixture();
      const record = {
        ...f.record,
        [field]:
          field === "state" ? { state: "pending" as const } : "different",
      };
      vi.spyOn(f.client, "get").mockResolvedValueOnce(record);
      const replace = vi.spyOn(f.client, "replaceDocument");
      await expect(
        f.repository.updateViewSource({
          path: f.record.path,
          document: changed,
        }),
      ).rejects.toThrow("complete record READ");
      expect(replace).not.toHaveBeenCalled();
    },
  );
  it("distinguishes edit authority from delete authority", async () => {
    const f = await fixture({
      role: "editor",
      capabilities: ["collection.read", "records.edit"],
    });
    const remove = vi.spyOn(f.client, "delete");
    await expect(
      f.repository.deleteViewSource(f.record.path),
    ).rejects.toMatchObject({ reason: "unsupported" });
    expect(remove).not.toHaveBeenCalled();
    expect(
      (
        await f.repository.updateViewSource({
          path: f.record.path,
          document: changed,
        })
      ).document,
    ).toBe(changed);
  });
  it("deletes only the native UUID with READ revision CAS and retires its descriptors", async () => {
    const f = await fixture();
    const remove = vi.spyOn(f.client, "delete");
    await f.repository.deleteViewSource(f.record.path);
    expect(remove).toHaveBeenCalledWith(
      f.record.id,
      expect.objectContaining({
        ifRevision: f.record.revision,
        mutationId: expect.any(String),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(await f.repository.cachedViews()).toEqual([]);
    await expect(
      f.repository.readViewSource(f.record.path),
    ).rejects.toMatchObject({ reason: "unsupported" });
    expect(f.generic).not.toHaveBeenCalled();
  });
});
