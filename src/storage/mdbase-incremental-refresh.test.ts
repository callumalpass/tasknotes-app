import { describe, expect, it, vi } from "vitest";
import {
  connectError,
  connectFailure,
  connectSuccess,
} from "@mdbase-dev/connect-testing";
import type {
  CollectionChange,
  CollectionChangesPage,
  ConnectOutcome,
  CollectionDescription,
  JsonObject,
} from "@mdbase-dev/connect";
import { MdbaseTaskRepository } from "./mdbase-repository";
import { resolveTaskCollection } from "./tasknotes-collection";
import {
  deferred,
  mdbaseFixture,
  multipleProviderDescription,
  taskRecord,
  type TestRecord,
} from "../test/mdbase-fixture";

async function setup(
  initial: TestRecord[] = [taskRecord("one", "One", "r1")],
  override?: CollectionDescription,
) {
  const fixture = mdbaseFixture(initial);
  const description = override ?? (await fixture.describe());
  description.operations.push("changes");
  const events: CollectionChange[] = [];
  const change = (type: string, payload: CollectionChange["payload"]) => {
    events.push({
      cursor: ++description.changeCursor,
      type,
      payload,
      occurredAt: "2026-09-19T00:00:00Z",
    });
  };
  fixture.describe.mockImplementation(async () => structuredClone(description));
  const changes = vi.fn(
    async ({
      after = 0,
      limit = 1000,
    }: {
      after?: number;
      limit?: number;
    }): Promise<ConnectOutcome<CollectionChangesPage>> =>
      connectSuccess<CollectionChangesPage>({
        events: events.filter((event) => event.cursor > after).slice(0, limit),
        cursor: description.changeCursor,
        hasMore: false,
        reset: false,
      }),
  );
  Object.assign(fixture.connect, { changes });
  const query = fixture.query.getMockImplementation()!;
  fixture.query.mockImplementation(async (input) => {
    const response = await query(input);
    if (typeof input?.where === "string") {
      const paths = [
        ...input.where.matchAll(/file\.path == ("(?:[^"\\]|\\.)*")/g),
      ].map((match) => JSON.parse(match[1]));
      response.result.results = response.result.results.filter((record) =>
        paths.includes(record.path),
      );
    }
    return response;
  });
  const repository = new MdbaseTaskRepository(fixture.connect);
  await repository.initialize();
  fixture.queryPages.mockClear();
  return { ...fixture, repository, description, changes, change };
}

describe("incremental repository refresh", () => {
  it("does not reload tasks or invalidate data on an unchanged refresh", async () => {
    const fixture = await setup();
    const before = await fixture.repository.list();
    const listener = vi.fn();
    fixture.repository.subscribe(listener);
    expect(await fixture.repository.refresh()).toMatchObject({
      scanned: 0,
      changed: 0,
      removed: 0,
    });
    expect(fixture.queryPages).not.toHaveBeenCalled();
    expect((await fixture.repository.list())[0]).toBe(before[0]);
    expect(listener.mock.calls).toEqual([
      [{ kind: "status" }],
      [{ kind: "status" }],
    ]);
  });

  it("reconciles create, edit, delete, rename and task-type removal from exact paths", async () => {
    const fixture = await setup(
      [
        taskRecord("one", "One", "r1"),
        taskRecord("two", "Two", "r2"),
        taskRecord("three", "Three", "r3"),
        taskRecord("four", "Four", "r4"),
      ].map((record, index) => ({ ...record, path: `tasks/${index}.md` })),
    );
    const one = fixture.records.get("tasks/0.md")!;
    fixture.records.set(one.path, { ...one, body: "Edited body" });
    fixture.change("mdbase.record.modified", { path: one.path });
    fixture.records.delete("tasks/1.md");
    fixture.change("mdbase.record.deleted", { path: "tasks/1.md" });
    const three = fixture.records.get("tasks/2.md")!;
    fixture.records.delete(three.path);
    fixture.records.set("tasks/renamed.md", {
      ...three,
      path: "tasks/renamed.md",
    });
    fixture.change("mdbase.record.renamed", {
      from: three.path,
      to: "tasks/renamed.md",
    });
    const four = fixture.records.get("tasks/3.md")!;
    fixture.records.set(four.path, { ...four, types: ["note"] });
    fixture.change("mdbase.record.modified", {
      path: four.path,
      types: ["note"],
    });
    const added = { ...taskRecord("five", "Five", "r5"), path: 'tasks/a"b.md' };
    fixture.records.set(added.path, added);
    fixture.change("mdbase.record.created", { path: added.path });

    expect(await fixture.repository.refresh()).toMatchObject({
      scanned: 3,
      changed: 3,
      removed: 2,
    });
    expect(await fixture.repository.list({ status: "all" })).toHaveLength(3);
    expect(await fixture.repository.get("one")).toMatchObject({
      body: "Edited body",
    });
    expect(await fixture.repository.get("three")).toMatchObject({
      path: "tasks/renamed.md",
    });
    expect(await fixture.repository.get("two")).toBeNull();
    expect(await fixture.repository.get("four")).toBeNull();
    expect(fixture.queryPages).toHaveBeenCalledOnce();
    expect(fixture.queryPages.mock.calls[0][0]?.where).toContain(
      JSON.stringify(added.path),
    );
    expect(fixture.changes).toHaveBeenCalledWith(
      { after: 0, limit: 1000 },
      expect.anything(),
    );
    await fixture.repository.refresh();
    expect(fixture.changes).toHaveBeenLastCalledWith(
      { after: 5, limit: 1000 },
      expect.anything(),
    );
  });

  it("preserves custom provider field mappings through incremental refresh and subsequent writes", async () => {
    const description = multipleProviderDescription();
    const provider = resolveTaskCollection(description).providers.find(
      (candidate) => candidate.typeName === "work_task",
    )!;
    const task = provider.model.create(
      { title: "Mapped" },
      { id: "mapped", now: "2026-09-19T00:00:00Z" },
    );
    const record: TestRecord = {
      path: task.path,
      frontmatter: task.frontmatter as JsonObject,
      body: task.body,
      types: ["work_task"],
      revision: "r1",
    };
    const fixture = await setup([record], description);
    fixture.records.set(record.path, {
      ...record,
      frontmatter: { ...record.frontmatter, summary: "Externally edited" },
    });
    fixture.change("mdbase.record.modified", {
      path: record.path,
      types: ["work_task"],
    });
    expect(await fixture.repository.refresh()).toMatchObject({
      scanned: 1,
      changed: 1,
    });
    expect((await fixture.repository.list())[0].title).toBe(
      "Externally edited",
    );
    await fixture.repository.update(task.id, { title: "Updated again" });
    expect(fixture.update).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({ summary: "Updated again" }),
      }),
      expect.anything(),
    );
  });

  it("uses a new snapshot for cursor resets and unknown/schema events", async () => {
    for (const mode of ["reset", "problem", "unknown", "schema"]) {
      const fixture = await setup();
      if (mode === "reset")
        fixture.changes.mockResolvedValueOnce(
          connectSuccess({
            events: [],
            cursor: 0,
            hasMore: false,
            reset: true,
          }),
        );
      else if (mode === "problem")
        fixture.changes.mockResolvedValueOnce(
          connectFailure(
            connectError("change_cursor_reset", "Expired").problem,
          ),
        );
      else
        fixture.change(
          mode === "schema" ? "mdbase.type.changed" : "future.event",
          {},
        );
      expect(await fixture.repository.refresh()).toMatchObject({ scanned: 1 });
      expect(fixture.queryPages.mock.calls[0][0]).not.toHaveProperty("where");
    }
  });

  it("invalidates views without downloading tasks for a view-source event", async () => {
    const fixture = await setup();
    const listener = vi.fn();
    fixture.repository.subscribe(listener);
    fixture.change("mdbase.view.changed", { path: "views/tasks.base" });
    await fixture.repository.refresh();
    expect(fixture.queryPages).not.toHaveBeenCalled();
    expect(listener).toHaveBeenLastCalledWith({ kind: "data" });
  });

  it("does not publish partial pages or advance the cursor after a failed query", async () => {
    const fixture = await setup();
    const old = (await fixture.repository.list())[0];
    const record = [...fixture.records.values()][0];
    fixture.records.set(record.path, { ...record, body: "New" });
    fixture.change("mdbase.record.modified", { path: record.path });
    const pages = fixture.queryPages.getMockImplementation()!;
    fixture.queryPages.mockImplementationOnce((input) =>
      (async function* () {
        yield* pages(input);
        throw new Error("Disconnected after first page");
      })(),
    );
    await fixture.repository.refresh();
    expect((await fixture.repository.list())[0]).toBe(old);
    expect(await fixture.repository.connectionStatus()).toMatchObject({
      state: "unavailable",
    });
    await fixture.repository.refresh();
    expect(fixture.changes.mock.calls.map(([input]) => input.after)).toEqual([
      0, 0,
    ]);
    expect((await fixture.repository.list())[0].body).toBe("New");
  });

  it("keeps a forced rebuild pending when a configuration-change query fails", async () => {
    const fixture = await setup();
    fixture.description.configuration = { changed: true };
    fixture.queryPages.mockImplementationOnce(() => {
      throw new Error("Unavailable");
    });
    await fixture.repository.refresh();
    await fixture.repository.refresh();
    expect(fixture.changes).not.toHaveBeenCalled();
    expect(fixture.queryPages.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      "where",
    );
  });

  it.each([
    ["update", "full"],
    ["delete", "full"],
    ["create", "full"],
    ["update", "delta"],
    ["delete", "delta"],
    ["create", "delta"],
  ] as const)(
    "does not overwrite an accepted local %s with an older %s snapshot",
    async (action, mode) => {
      const fixture = await setup();
      const record = [...fixture.records.values()][0];
      fixture.change(
        mode === "full"
          ? "mdbase.collection.invalidated"
          : "mdbase.record.modified",
        { path: record.path },
      );
      const captured = deferred<void>();
      const release = deferred<void>();
      const pages = fixture.queryPages.getMockImplementation()!;
      fixture.queryPages.mockImplementationOnce((input) =>
        (async function* () {
          // Snapshot predates the accepted write, but completes after it.
          for await (const page of pages(input)) {
            captured.resolve();
            await release.promise;
            yield page;
          }
        })(),
      );
      const refresh = fixture.repository.refresh();
      await captured.promise;
      let createdId: string | undefined;
      if (action === "update")
        await fixture.repository.update("one", { body: "Accepted local edit" });
      if (action === "delete") await fixture.repository.delete("one");
      if (action === "create")
        createdId = (
          await fixture.repository.create({ title: "Accepted local create" })
        ).id;
      release.resolve();
      await refresh;
      if (action === "update")
        expect(await fixture.repository.get("one")).toMatchObject({
          body: "Accepted local edit",
        });
      if (action === "delete")
        expect(await fixture.repository.get("one")).toBeNull();
      if (action === "create")
        expect(await fixture.repository.get(createdId!)).toMatchObject({
          title: "Accepted local create",
        });
    },
  );

  it("coalesces paged events and bounds changed-path query batches", async () => {
    const fixture = await setup();
    const first = Array.from({ length: 100 }, (_, index): CollectionChange => ({
      cursor: index + 1,
      type: "mdbase.record.modified",
      payload: { path: `notes/${index}.md` },
      occurredAt: "2026-09-19T00:00:00Z",
    }));
    const second: CollectionChange[] = [
      first[0],
      {
        ...first[0],
        cursor: 101,
        payload: { path: [...fixture.records.keys()][0] },
      },
    ];
    fixture.changes.mockResolvedValueOnce(
      connectSuccess({
        events: first,
        cursor: 100,
        hasMore: true,
        reset: false,
      }),
    );
    fixture.changes.mockResolvedValueOnce(
      connectSuccess({
        events: second,
        cursor: 101,
        hasMore: false,
        reset: false,
      }),
    );
    expect(await fixture.repository.refresh()).toMatchObject({
      scanned: 1,
      changed: 0,
    });
    expect(fixture.changes.mock.calls.map(([input]) => input.after)).toEqual([
      0, 100,
    ]);
    expect(fixture.queryPages).toHaveBeenCalledTimes(2);
    for (const [input] of fixture.queryPages.mock.calls)
      expect(String(input?.where).split(" || ").length).toBeLessThanOrEqual(
        100,
      );
  });

  it("bounds a large backlog and rejects a non-progressing change cursor", async () => {
    for (const mode of ["large", "stuck", "pages"]) {
      const fixture = await setup();
      if (mode === "large") {
        for (let i = 0; i < 501; i++)
          fixture.change("mdbase.record.modified", { path: `notes/${i}.md` });
      } else if (mode === "stuck")
        fixture.changes.mockResolvedValue(
          connectSuccess({
            events: [],
            cursor: 0,
            hasMore: true,
            reset: false,
          }),
        );
      else
        fixture.changes.mockImplementation(async ({ after = 0 }) =>
          connectSuccess({
            events: [],
            cursor: after + 1,
            hasMore: true,
            reset: false,
          }),
        );
      await fixture.repository.refresh();
      expect(fixture.queryPages.mock.calls[0][0]).not.toHaveProperty("where");
      expect(fixture.changes).toHaveBeenCalledTimes(mode === "pages" ? 10 : 1);
    }
  });

  it("does not convert a changes transport failure into an expensive full query", async () => {
    const fixture = await setup();
    fixture.changes.mockRejectedValueOnce(new Error("Offline"));
    await fixture.repository.refresh();
    expect(fixture.queryPages).not.toHaveBeenCalled();
    expect(await fixture.repository.connectionStatus()).toMatchObject({
      state: "unavailable",
    });
  });

  it("rejects old snapshot pages even if the lifecycle resumes before they arrive", async () => {
    const fixture = await setup();
    const old = (await fixture.repository.list())[0];
    const record = [...fixture.records.values()][0];
    fixture.records.set(record.path, { ...record, body: "New" });
    fixture.change("mdbase.record.modified", { path: record.path });
    const captured = deferred<void>();
    const release = deferred<void>();
    const pages = fixture.queryPages.getMockImplementation()!;
    fixture.queryPages.mockImplementationOnce((input) =>
      (async function* () {
        for await (const page of pages(input)) {
          captured.resolve();
          await release.promise;
          yield page;
        }
      })(),
    );
    const refresh = fixture.repository.refresh();
    await captured.promise;
    fixture.repository.suspend();
    fixture.repository.resume();
    release.resolve();
    await refresh;
    expect((await fixture.repository.list())[0]).toBe(old);
    await fixture.repository.refresh();
    expect((await fixture.repository.list())[0].body).toBe("New");
    expect(fixture.changes.mock.calls.map(([input]) => input.after)).toEqual([
      0, 0,
    ]);
  });

  it("starts replay before the initial snapshot, not after it", async () => {
    const fixture = mdbaseFixture([taskRecord("one", "One", "r1")]);
    const description = await fixture.describe();
    description.operations.push("changes");
    fixture.describe.mockImplementation(async () =>
      structuredClone(description),
    );
    const pages = fixture.queryPages.getMockImplementation()!;
    fixture.queryPages.mockImplementation((input) =>
      (async function* () {
        description.changeCursor = 1;
        yield* pages(input);
      })(),
    );
    const changes = vi.fn(async () =>
      connectSuccess({ events: [], cursor: 1, hasMore: false, reset: false }),
    );
    Object.assign(fixture.connect, { changes });
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    await repository.refresh();
    expect(changes).toHaveBeenCalledWith(
      { after: 0, limit: 1000 },
      expect.anything(),
    );
  });
});
