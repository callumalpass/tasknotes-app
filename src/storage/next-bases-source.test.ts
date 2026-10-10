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
  it.each([
    { options: {}, writable: true },
    {
      options: {
        role: "editor" as const,
        capabilities: ["collection.read", "records.edit"],
      },
      writable: true,
    },
    { options: { role: "viewer" as const }, writable: false },
    {
      options: { capabilities: ["collection.read", "records.delete"] },
      writable: false,
    },
    { options: { capabilities: ["records.edit"] }, writable: false },
  ])(
    "advertises editability from the actual full-scope native grant: %j",
    async ({ options, writable }) => {
      const f = await fixture(options);
      const documents = await f.repository.listViews();
      expect(documents[0]!.source.writable).toBe(writable);
      expect(documents[0]!.views[0]!.source.writable).toBe(writable);
      expect(f.generic).not.toHaveBeenCalled();
    },
  );
  it("does not advertise editability for folder-scoped source authority", async () => {
    const f = await fixture();
    f.client.hello.grant.fileFolders = ["tasks"];
    const documents = await f.repository.listViews();
    expect(documents[0]!.source.writable).toBe(false);
    expect(documents[0]!.views[0]!.source.writable).toBe(false);
  });
  it("explicitly creates a source with one captured UUID and actual complete readback", async () => {
    const f = await fixture();
    const create = vi.spyOn(f.client, "create");
    const helper = vi.spyOn(f.client.views, "createSource");
    const read = vi.spyOn(f.client.views, "getSourceRecord");
    const result = await f.repository.createViewSource({
      path: "new.base",
      document,
    });
    expect(create).toHaveBeenCalledOnce();
    expect(helper).toHaveBeenCalledWith(
      { id: result.recordId, path: "new.base", document },
      expect.objectContaining({
        mutationId: expect.any(String),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(read).toHaveBeenCalledWith(result.recordId, {
      signal: expect.any(AbortSignal),
    });
    expect(result).toMatchObject({
      path: "new.base",
      document,
      format: "obsidian.base",
    });
    const record = await f.client.get(result.recordId!, { document: true });
    expect(record.id).toBe(result.recordId);
    expect(record.path).toBe(result.path);
    expect(record.revision).toBe(result.revision);
    expect(record.document).toBe(result.document);
    expect(f.generic).not.toHaveBeenCalled();
  });
  it("recovers creation through the original UUID/MID after an unknown result READ without resubmitting", async () => {
    const f = await fixture();
    const create = vi.spyOn(f.client.views, "createSource");
    const read = vi
      .spyOn(f.client.views, "getSourceRecord")
      .mockRejectedValueOnce(new Error("READ unavailable"));
    const input = { path: "new.base", document };
    await expect(f.repository.createViewSource(input)).rejects.toMatchObject({
      problem: { code: "operation_outcome_unknown" },
      cause: { message: "READ unavailable" },
    });
    const originalId = create.mock.calls[0]![0].id;
    const result = await f.repository.createViewSource(input);
    expect(create).toHaveBeenCalledOnce();
    expect(result.recordId).toBe(originalId);
    expect(read.mock.calls.map(([id]) => id)).toEqual([originalId, originalId]);
  });
  it.each([
    { role: "viewer" as const },
    { capabilities: ["collection.read"] },
    { capabilities: ["records.edit"] },
  ])(
    "refuses creation before capturing an ID or submitting without full-scope edit authority: %j",
    async (options) => {
      const f = await fixture(options);
      const create = vi.spyOn(f.client.views, "createSource");
      const read = vi.spyOn(f.client.views, "getSourceRecord");
      const uuid = vi.spyOn(crypto, "randomUUID");
      await expect(
        f.repository.createViewSource({ path: "new.base", document }),
      ).rejects.toMatchObject({ reason: "unsupported" });
      expect(create).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      // Only the existing manager's MID is captured; prepare refuses before
      // capturing a second UUID for a source or submitting an admission.
      expect(uuid).toHaveBeenCalledOnce();
    },
  );
  it.each([
    { path: "new.md", document: "---\nkind: mdbase.view\n---\n" },
    { path: "new.base", format: "mdbase.view", document },
  ])(
    "refuses unsupported source formats before a source admission: %j",
    async (input) => {
      const f = await fixture();
      const create = vi.spyOn(f.client.views, "createSource");
      await expect(f.repository.createViewSource(input)).rejects.toMatchObject({
        reason: "unsupported",
      });
      expect(create).not.toHaveBeenCalled();
    },
  );
  it.each(["id", "path", "document", "hold", "unresolved"] as const)(
    "retains the original creation admission on mismatching or unsafe local READ %s",
    async (field) => {
      const f = await fixture();
      const create = vi.spyOn(f.client.views, "createSource");
      const get = f.client.get.bind(f.client);
      vi.spyOn(f.client, "get").mockImplementation(async (...args) => {
        const record = await get(...args);
        if (field === "id")
          return { ...record, id: "00000000-0000-0000-0000-000000000003" };
        if (field === "path") return { ...record, path: "other.base" };
        if (field === "document") return { ...record, document: changed };
        if (field === "hold")
          return {
            ...record,
            state: {
              ...record.state,
              hold: {
                id: "00000000-0000-0000-0000-000000000003",
                reason: "conflict" as const,
              },
            },
          };
        if (field === "unresolved")
          return { ...record, state: { ...record.state, unresolved: 1 } };
        return {
          ...record,
          state: { ...record.state, state: "pending" as const },
        };
      });
      const input = { path: "new.base", document };
      await expect(f.repository.createViewSource(input)).rejects.toMatchObject({
        problem: { code: "operation_outcome_unknown" },
      });
      await expect(f.repository.createViewSource(input)).rejects.toMatchObject({
        problem: { code: "operation_outcome_unknown" },
      });
      expect(create).toHaveBeenCalledOnce();
      expect(f.generic).not.toHaveBeenCalled();
    },
  );
  it("returns genuine pending source bytes without reporting authority confirmation", async () => {
    const f = await fixture();
    const get = f.client.get.bind(f.client);
    vi.spyOn(f.client, "get").mockImplementation(async (...args) => {
      const record = await get(...args);
      return {
        ...record,
        state: { ...record.state, state: "pending" as const },
      };
    });
    const create = vi.spyOn(f.client.views, "createSource");
    const source = await f.repository.createViewSource({
      path: "new.base",
      document,
    });
    expect(source.document).toBe(document);
    expect(f.repository.writeState({ kind: "source", path: source.path })).toBe(
      "pending",
    );
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]![1]?.wait).toBe("pending");
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
      ).rejects.toThrow(
        field === "id"
          ? "view source writes need their original record and mutation UUIDs"
          : field === "revision"
            ? "view source needs its original source revision"
            : field === "document"
              ? "view source document differs from its captured revision"
              : "complete record READ",
      );
      expect(replace).not.toHaveBeenCalled();
    },
  );
  it.each([
    {
      hold: {
        id: "00000000-0000-0000-0000-000000000003",
        reason: "conflict" as const,
      },
    },
    { unresolved: 1 },
  ])(
    "refuses editing a held or unresolved full seen record before submission: %j",
    async (problem) => {
      const f = await fixture();
      vi.spyOn(f.client, "get").mockResolvedValueOnce({
        ...f.record,
        state: { ...f.record.state, ...problem },
      });
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
  it.each([
    {
      hold: {
        id: "00000000-0000-0000-0000-000000000003",
        reason: "conflict" as const,
      },
    },
    { unresolved: 1 },
  ])(
    "retains original update admission when confirmed source readback is held or unresolved: %j",
    async (problem) => {
      const f = await fixture();
      const get = f.client.get.bind(f.client);
      vi.spyOn(f.client, "get")
        .mockResolvedValueOnce(f.record)
        .mockImplementation(async (...args) => {
          const record = await get(...args);
          return { ...record, state: { ...record.state, ...problem } };
        });
      const replace = vi.spyOn(f.client, "replaceDocument");
      const input = { path: f.record.path, document: changed };
      await expect(f.repository.updateViewSource(input)).rejects.toMatchObject({
        problem: { code: "operation_outcome_unknown" },
      });
      await expect(f.repository.updateViewSource(input)).rejects.toMatchObject({
        problem: { code: "operation_outcome_unknown" },
      });
      expect(replace).toHaveBeenCalledOnce();
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
  it("supplies the genuine complete seen record, not a descriptor UUID, for deletion CAS", async () => {
    const f = await fixture();
    const remove = vi.spyOn(f.client, "delete");
    await f.repository.deleteViewSource(f.record.path);
    expect(remove).toHaveBeenCalledWith(
      f.record,
      expect.objectContaining({
        ifRevision: f.record.revision,
        mutationId: expect.any(String),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(await f.client.find({ path: f.record.path })).toBeNull();
  });
  it.each([
    {
      hold: {
        id: "00000000-0000-0000-0000-000000000003",
        reason: "conflict" as const,
      },
    },
    { unresolved: 1 },
  ])(
    "refuses deletion of a held or unresolved genuine record: %j",
    async (problem) => {
      const f = await fixture();
      vi.spyOn(f.client, "get").mockResolvedValueOnce({
        ...f.record,
        state: { ...f.record.state, ...problem },
      });
      const remove = vi.spyOn(f.client, "delete");
      await expect(
        f.repository.deleteViewSource(f.record.path),
      ).rejects.toThrow("complete record READ");
      expect(remove).not.toHaveBeenCalled();
    },
  );
  it("preserves original deletion admission and rereads absence without resubmitting after unknown READ", async () => {
    const f = await fixture();
    const remove = vi.spyOn(f.client, "delete");
    const find = f.client.find.bind(f.client);
    const absence = vi
      .spyOn(f.client, "find")
      .mockRejectedValueOnce(new Error("READ unavailable"))
      .mockImplementation(find);
    await expect(
      f.repository.deleteViewSource(f.record.path),
    ).rejects.toMatchObject({ problem: { code: "operation_outcome_unknown" } });
    await f.repository.deleteViewSource(f.record.path);
    expect(remove).toHaveBeenCalledOnce();
    expect(absence).toHaveBeenCalledTimes(2);
    expect(absence.mock.calls.every(([target]) => target === f.record.id)).toBe(
      true,
    );
  });
  it("does not certify deletion while the original native UUID remains readable", async () => {
    const f = await fixture();
    const remove = vi.spyOn(f.client, "delete");
    vi.spyOn(f.client, "find").mockResolvedValue(f.record);
    await expect(
      f.repository.deleteViewSource(f.record.path),
    ).rejects.toMatchObject({ problem: { code: "operation_outcome_unknown" } });
    await expect(
      f.repository.deleteViewSource(f.record.path),
    ).rejects.toMatchObject({ problem: { code: "operation_outcome_unknown" } });
    expect(remove).toHaveBeenCalledOnce();
  });
  it("deletes only the native UUID with READ revision CAS and retires its descriptors", async () => {
    const f = await fixture();
    const remove = vi.spyOn(f.client, "delete");
    await f.repository.deleteViewSource(f.record.path);
    expect(remove).toHaveBeenCalledWith(
      f.record,
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
