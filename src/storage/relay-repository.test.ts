import type {
  CollectionDescription,
  JsonObject,
  MdbaseConnection,
  MdbaseOperationEnvelope,
  QueryResult,
  RecordResult,
} from "@mdbase/connect";
import { buildTaskNotesMdbaseResources } from "@tasknotes/model/mdbase";
import { describe, expect, it, vi } from "vitest";

import { todayString } from "../domain/task";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { CloudTaskRepository } from "./cloud-repository";
import { createConnectTaskRepository } from "./connect-repository";
import { RelayTaskRepository } from "./relay-repository";

describe("relay task repository", () => {
  it("coalesces record completion into one small provider query", async () => {
    const project: RecordResult<JsonObject> = {
      path: "Projects/Mobile.md",
      frontmatter: { title: "Mobile roadmap" },
      body: "",
      types: ["project"],
      revision: "project-r1",
    };
    const fixture = relayFixture([
      taskRecord("existing", "Review relay support", "r1"),
      project,
    ]);
    const repository = new RelayTaskRepository(fixture.connect);
    await repository.initialize();

    const request = {
      field: "projects",
      kind: "records" as const,
      query: "mobile",
      limit: 10,
    };
    const [first, second] = await Promise.all([
      repository.completeField(request),
      repository.completeField(request),
    ]);

    expect(first).toEqual(second);
    expect(first).toContainEqual({
      kind: "record",
      value: "[[Projects/Mobile]]",
      label: "Mobile roadmap",
      detail: "Projects/Mobile.md",
      path: "Projects/Mobile.md",
    });
    expect(fixture.query).toHaveBeenCalledTimes(2);
    const completionQuery = fixture.query.mock.calls[1]?.[0];
    expect(completionQuery).toMatchObject({
      limit: 48,
      order_by: [{ field: "file.path", direction: "asc" }],
    });
    expect(String(completionQuery?.where)).toContain(
      'file.path.lower().contains("mobile")',
    );
  });

  it("opens, searches, and mutates a TaskNotes collection over live operations", async () => {
    const fixture = relayFixture([
      taskRecord("existing", "Review relay support", "r1"),
    ]);
    const repository = new RelayTaskRepository(fixture.connect);

    await repository.initialize();
    expect(await repository.list({ search: "relay" })).toMatchObject([
      { id: "existing", title: "Review relay support" },
    ]);
    expect(await repository.collectionInfo()).toMatchObject({
      kind: "connect",
      name: "Local tasks",
    });

    const [renamed, detailed] = await Promise.all([
      repository.update("existing", { title: "Ship relay support" }),
      repository.update("existing", { body: "Tested through Connect." }),
    ]);
    expect(renamed.title).toBe("Ship relay support");
    expect(detailed).toMatchObject({
      title: "Ship relay support",
      body: "Tested through Connect.",
    });
    expect(fixture.read).toHaveBeenCalledTimes(1);
    expect(
      fixture.update.mock.calls.map(([input]) => input.if_revision),
    ).toEqual(["r1", "r2"]);

    const created = await repository.create({ title: "New relay task" });
    expect(created.title).toBe("New relay task");
    await repository.delete(created.id);
    expect(await repository.get(created.id)).toBeNull();
    expect(fixture.remove).toHaveBeenCalledWith(
      expect.objectContaining({ if_revision: "r4" }),
    );
    expect(await repository.syncStatus()).toMatchObject({
      mode: "live",
      state: "synced",
      pending: 0,
    });
  });

  it("reloads the canonical description and lets the provider own create paths", async () => {
    const collectionId = crypto.randomUUID();
    const fixture = relayFixture([], false, false, collectionId);
    const repository = new RelayTaskRepository(fixture.connect);
    await repository.initialize();
    const next = description(false, false, collectionId);
    next.types[0] = {
      ...next.types[0],
      name: "todo",
      collection: { path: { pattern: "canonical/{id}.md" } },
    };
    next.contracts[0] = { ...next.contracts[0], type_name: "todo" };
    fixture.describe.mockResolvedValueOnce(next);

    await repository.refresh();
    const created = await repository.create({ title: "Provider path" });

    expect(created.frontmatter.type).toBe("todo");
    expect(fixture.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "todo" }),
    );
    expect(fixture.create.mock.calls.at(-1)?.[0]).not.toHaveProperty("path");
  });

  it("prefetches one revision read and reuses it for a later delete", async () => {
    const fixture = relayFixture([
      taskRecord("delete-me", "Delete without a second wait", "r1"),
    ]);
    const repository = new RelayTaskRepository(fixture.connect);
    await repository.initialize();

    await repository.get("delete-me");
    await repository.delete("delete-me");

    expect(fixture.read).toHaveBeenCalledTimes(1);
    expect(fixture.remove).toHaveBeenCalledWith(
      expect.objectContaining({ if_revision: "r1" }),
    );
  });

  it("keeps the current session readable when a refresh cannot reach the connector", async () => {
    const fixture = relayFixture([
      taskRecord("cached", "Visible while unavailable", "r1"),
    ]);
    const repository = new RelayTaskRepository(fixture.connect);
    await repository.initialize();
    fixture.query.mockRejectedValueOnce(
      new TypeError("The computer is unavailable."),
    );

    const refreshed = await repository.refresh();

    expect(refreshed.scanned).toBe(1);
    expect(await repository.get("cached")).toMatchObject({
      title: "Visible while unavailable",
    });
    expect(await repository.syncStatus()).toMatchObject({
      mode: "live",
      state: "offline",
    });
  });

  it("round-trips time sessions through revision-guarded relay writes", async () => {
    const fixture = relayFixture([
      taskRecord("timed", "Profile the relay", "r1"),
    ]);
    const repository = new RelayTaskRepository(fixture.connect);
    await repository.initialize();

    const started = await repository.startTimeTracking("timed", "Relay run");
    expect(started.timeEntries[0]).toMatchObject({
      description: "Relay run",
    });
    const stopped = await repository.stopTimeTracking("timed");
    expect(stopped.timeEntries[0].endTime).toMatch(/Z$/);
    const replaced = await repository.replaceTimeEntries("timed", [
      {
        startTime: "2026-07-22T09:00:00+10:00",
        endTime: "2026-07-22T10:00:00+10:00",
      },
    ]);
    expect(replaced.timeEntries[0]).toEqual({
      startTime: "2026-07-21T23:00:00Z",
      endTime: "2026-07-22T00:00:00Z",
    });
    expect((await repository.removeTimeEntry("timed", 0)).timeEntries).toEqual(
      [],
    );
    expect(
      fixture.update.mock.calls.map(([input]) => input.if_revision),
    ).toEqual(["r1", "r2", "r3", "r4"]);
  });

  it("creates one durable relay occurrence and reconciles its parent", async () => {
    const parent = taskRecord("series", "Relay recurrence", "r1");
    parent.frontmatter.scheduled = "2026-08-05";
    parent.frontmatter.recurrence = "FREQ=DAILY;INTERVAL=1;DTSTART=20260805";
    const fixture = relayFixture([parent]);
    const repository = new RelayTaskRepository(fixture.connect);
    await repository.initialize();

    const first = await repository.materializeOccurrence(
      "series",
      "2026-08-05",
    );
    const duplicate = await repository.materializeOccurrence(
      "series",
      "2026-08-05",
    );
    expect(first.created).toBe(true);
    expect(duplicate).toMatchObject({
      created: false,
      task: { id: first.task.id },
    });
    expect(fixture.create).toHaveBeenCalledTimes(1);

    const completed = await repository.toggle(first.task.id);
    expect(completed.completed).toBe(true);
    expect((await repository.get("series"))?.completeInstances).toContain(
      "2026-08-05",
    );
    expect(fixture.update).toHaveBeenCalledTimes(2);
  });

  it("maintains a rolling window when an existing relay collection opens", async () => {
    const today = todayString();
    const parent = taskRecord("rolling", "Relay rolling window", "r1");
    parent.frontmatter.scheduled = today;
    parent.frontmatter.recurrence = `FREQ=DAILY;INTERVAL=1;DTSTART=${today.replaceAll("-", "")}`;
    parent.frontmatter.occurrence_materialization = "rolling";
    parent.frontmatter.occurrence_past_horizon = "P0D";
    parent.frontmatter.occurrence_future_horizon = "P2D";
    const fixture = relayFixture([parent]);
    const repository = new RelayTaskRepository(fixture.connect);

    await repository.initialize();
    expect(fixture.create).toHaveBeenCalledTimes(3);
    expect(
      (await repository.list({ status: "all", limit: 100 })).filter(
        (task) => task.recurrenceParent && task.occurrenceDate,
      ),
    ).toHaveLength(3);

    await repository.refresh();
    expect(fixture.create).toHaveBeenCalledTimes(3);
  });

  it("archives, moves, hides, and restores a live collection task", async () => {
    const fixture = relayFixture(
      [taskRecord("archived", "Relay archive", "r1")],
      false,
      true,
    );
    const repository = new RelayTaskRepository(fixture.connect);
    await repository.initialize();

    const archived = await repository.setArchived("archived", true);
    expect(archived).toMatchObject({
      archived: true,
      path: "TaskNotes/Archive/archived.md",
    });
    expect(await repository.list({ status: "all" })).toEqual([]);
    expect(
      await repository.list({ status: "all", archived: "only" }),
    ).toHaveLength(1);
    expect(fixture.rename).toHaveBeenLastCalledWith({
      from: "tasks/archived.md",
      to: "TaskNotes/Archive/archived.md",
      if_revision: "r2",
      update_refs: true,
    });

    const restored = await repository.setArchived("archived", false);
    expect(restored).toMatchObject({
      archived: false,
      path: "tasks/archived.md",
    });
    expect(await repository.list({ status: "all" })).toHaveLength(1);
  });

  it("lists and executes provider-owned saved views", async () => {
    const fixture = relayFixture([
      taskRecord("board", "Visible on the board", "r1"),
    ]);
    const repository = new RelayTaskRepository(fixture.connect);
    await repository.initialize();

    const [document] = await repository.listViews();
    const [view] = document.views;
    expect(view).toMatchObject({
      id: "kanban",
      name: "Kanban",
      presentation: { type: "tasknotes.kanban" },
    });
    const execution = await repository.executeView(view);
    expect(execution.rows[0]).toMatchObject({
      task: { id: "board", title: "Visible on the board" },
      values: { status: "open" },
    });
    expect(fixture.executeView).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "views/tasks.base",
        view: "kanban",
        render: false,
      }),
    );
  });

  it("coalesces concurrent executions of the same saved view", async () => {
    const fixture = relayFixture([
      taskRecord("board", "Visible on the board", "r1"),
    ]);
    const repository = new RelayTaskRepository(fixture.connect);
    await repository.initialize();
    const [document] = await repository.listViews();
    const view = document.views[0];
    const response = await fixture.executeView();
    const pending = deferred<typeof response>();
    fixture.executeView.mockClear();
    fixture.executeView.mockImplementationOnce(() => pending.promise);

    const first = repository.executeView(view);
    const second = repository.executeView(view);

    expect(fixture.executeView).toHaveBeenCalledTimes(1);
    pending.resolve(response);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fixture.executeView).toHaveBeenCalledTimes(1);
  });

  it("restores saved views and their last result across relay sessions", async () => {
    const collectionId = crypto.randomUUID();
    const firstFixture = relayFixture(
      [taskRecord("cached", "Cached relay task", "r1")],
      false,
      false,
      collectionId,
    );
    const first = new RelayTaskRepository(firstFixture.connect);
    await first.initialize();
    const [document] = await first.listViews();
    const view = document.views[0];
    const execution = await first.executeView(view);

    const reopenedFixture = relayFixture([], false, false, collectionId);
    reopenedFixture.listViews.mockRejectedValue(new Error("Still refreshing"));
    reopenedFixture.executeView.mockRejectedValue(
      new Error("Still refreshing"),
    );
    const reopened = new RelayTaskRepository(reopenedFixture.connect);
    await reopened.initialize();

    expect((await reopened.cachedViews())[0].views[0].name).toBe("Kanban");
    expect(await reopened.cachedViewExecution(view)).toEqual(execution);
    expect((await reopened.executeView(view)).stale).toBe(true);
    expect((await reopened.collectionInfo()).id).toBe(collectionId);
  });

  it("does not publish repeated state changes for the same operation failure", async () => {
    const fixture = relayFixture([]);
    const connect = {
      ...fixture.connect,
      readViewSource: undefined,
    } as unknown as MdbaseConnection<JsonObject>;
    const repository = new RelayTaskRepository(connect);
    await repository.initialize();
    const listener = vi.fn();
    repository.subscribe(listener);

    await expect(repository.readViewSource("Views/work.md")).rejects.toThrow(
      TypeError,
    );
    await expect(repository.readViewSource("Views/work.md")).rejects.toThrow(
      TypeError,
    );

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("round-trips writable saved-view sources with revisions", async () => {
    const fixture = relayFixture([]);
    const repository = new RelayTaskRepository(fixture.connect);
    await repository.initialize();

    const original = await repository.readViewSource("views/tasks.base");
    expect(original).toMatchObject({
      path: "views/tasks.base",
      format: "obsidian.base",
      revision: "view-r1",
    });

    const created = await repository.createViewSource({
      format: "obsidian.base",
      name: "Focused work",
      document: "views:\n  - name: Focused work\n    type: tasknotesTaskList\n",
    });
    expect(created.path).toBe("views/focused-work.base");

    const updated = await repository.updateViewSource({
      path: created.path,
      document: created.document.replace("Focused work", "Open work"),
      ifRevision: created.revision,
    });
    expect(updated).toMatchObject({ revision: "view-r3" });
    expect(fixture.updateViewSource).toHaveBeenCalledWith(
      expect.objectContaining({ if_revision: "view-r2" }),
    );

    await repository.deleteViewSource(updated.path, updated.revision);
    expect(fixture.deleteViewSource).toHaveBeenCalledWith({
      path: updated.path,
      if_revision: "view-r3",
    });
    await expect(repository.readViewSource(updated.path)).rejects.toThrow(
      "View source not found",
    );
    expect(fixture.listViews).not.toHaveBeenCalled();
  });

  it("creates from the configured template through the live relay", async () => {
    const fixture = relayFixture(
      [
        {
          path: "Templates/Task.md",
          frontmatter: { source: "relay-template", status: "done" },
          body: "Relay body for {{title}} on {{date}}",
          types: [],
          revision: "template-r1",
        },
      ],
      true,
    );
    const repository = new RelayTaskRepository(fixture.connect);
    await repository.initialize();

    const task = await repository.create({
      title: "Relay template",
      status: "open",
    });
    expect(task.status).toBe("open");
    expect(task.frontmatter.source).toBe("relay-template");
    expect(task.body).toMatch(
      /^Relay body for Relay template on \d{4}-\d{2}-\d{2}$/,
    );
    expect(fixture.read).toHaveBeenCalledWith({ path: "Templates/Task.md" });
  });

  it("hides hosted-versus-relay selection behind one repository factory", () => {
    const relay = relayFixture([]).connect;
    expect(createConnectTaskRepository(relay)).toBeInstanceOf(
      RelayTaskRepository,
    );
    const hosted = {
      hostedSync: () => ({ collectionId: "hosted", replicaId: "phone" }),
    } as unknown as MdbaseConnection<JsonObject>;
    expect(createConnectTaskRepository(hosted)).toBeInstanceOf(
      CloudTaskRepository,
    );
  });
});

function relayFixture(
  initial: RecordResult<JsonObject>[],
  templating = false,
  archive = false,
  collectionId = crypto.randomUUID(),
) {
  const records = new Map(initial.map((record) => [record.path, record]));
  let revision = initial.length + 1;
  const describeCollection = vi.fn(async () =>
    description(templating, archive, collectionId),
  );
  const query = vi.fn(async (input?: Record<string, unknown>) => {
    void input;
    return valid<QueryResult<JsonObject>>({
      results: [...records.values()].map((record) => ({
        path: record.path,
        frontmatter: record.frontmatter,
        raw_frontmatter: record.raw_frontmatter,
        body: record.body,
        types: record.types,
        file: record.file,
      })),
      meta: { total_count: records.size, has_more: false, snapshot: "tasks-1" },
    });
  });
  const read = vi.fn(async ({ path }: { path: string }) => {
    const record = records.get(path);
    if (!record) throw new Error("Task not found.");
    return valid(record);
  });
  const create = vi.fn(
    async (input: {
      path?: string;
      type?: string;
      frontmatter: JsonObject;
      body?: string;
    }) => {
      const path = input.path ?? `tasks/${crypto.randomUUID()}.md`;
      const record: RecordResult<JsonObject> = {
        path,
        frontmatter: structuredClone(input.frontmatter),
        body: input.body ?? "",
        types: [input.type ?? "task"],
        revision: `r${revision++}`,
      };
      records.set(path, record);
      return valid(record);
    },
  );
  const update = vi.fn(
    async (input: {
      path: string;
      patch: JsonObject;
      body?: string;
      if_revision?: string;
    }) => {
      const current = records.get(input.path);
      if (!current) throw new Error("Task not found.");
      if (input.if_revision !== current.revision)
        throw new Error("Revision conflict.");
      const frontmatter = structuredClone(current.frontmatter);
      for (const [key, value] of Object.entries(input.patch)) {
        if (value === null) delete frontmatter[key];
        else frontmatter[key] = structuredClone(value);
      }
      const record: RecordResult<JsonObject> = {
        ...current,
        frontmatter,
        body: input.body ?? current.body,
        revision: `r${revision++}`,
      };
      records.set(input.path, record);
      return valid(record);
    },
  );
  const remove = vi.fn(
    async (input: { path: string; if_revision?: string }) => {
      const current = records.get(input.path);
      if (!current) throw new Error("Task not found.");
      if (input.if_revision !== current.revision)
        throw new Error("Revision conflict.");
      records.delete(input.path);
      return valid({ path: input.path, deleted: true });
    },
  );
  const rename = vi.fn(
    async (input: {
      from: string;
      to: string;
      if_revision?: string;
      update_refs?: boolean;
    }) => {
      const current = records.get(input.from);
      if (!current) throw new Error("Task not found.");
      if (records.has(input.to)) throw new Error("Destination already exists.");
      if (input.if_revision !== current.revision)
        throw new Error("Revision conflict.");
      const record: RecordResult<JsonObject> = {
        ...current,
        path: input.to,
        revision: `r${revision++}`,
      };
      records.delete(input.from);
      records.set(input.to, record);
      return valid({ ...record, from: input.from, to: input.to });
    },
  );
  const listViews = vi.fn(async () =>
    valid({
      views: [
        {
          id: "tasks",
          name: "Tasks",
          source: {
            path: "views/tasks.base",
            format: "obsidian.base",
            revision: "sha256:view",
            writable: false,
          },
          views: [
            {
              id: "kanban",
              name: "Kanban",
              presentation: {
                type: "tasknotesKanban",
                options: {},
              },
            },
          ],
        },
      ],
      meta: { total_count: 1 },
    }),
  );
  const executeView = vi.fn(async () =>
    valid({
      results: [...records.values()].map((record) => ({
        path: record.path,
        frontmatter: record.frontmatter,
        body: record.body,
        types: record.types,
        values: { status: record.frontmatter.status ?? "open" },
      })),
      meta: {
        total_count: records.size,
        has_more: false,
        view: { path: "views/tasks.base", id: "kanban" },
        groups: [],
      },
    }),
  );
  const viewSources = new Map<
    string,
    {
      path: string;
      format: "obsidian.base" | "mdbase.view";
      revision: string;
      document: string;
    }
  >([
    [
      "views/tasks.base",
      {
        path: "views/tasks.base",
        format: "obsidian.base" as const,
        revision: "view-r1",
        document: "views:\n  - name: Kanban\n    type: tasknotesKanban\n",
      },
    ],
  ]);
  let viewRevision = 2;
  const readViewSource = vi.fn(async ({ path }: { path: string }) => {
    const source = viewSources.get(path);
    if (!source) throw new Error("View source not found.");
    return valid(structuredClone(source));
  });
  const createViewSource = vi.fn(
    async (input: {
      format: "obsidian.base" | "mdbase.view";
      name: string;
      document: string;
    }) => {
      const extension = input.format === "obsidian.base" ? "base" : "md";
      const path = `views/${input.name.toLowerCase().replaceAll(" ", "-")}.${extension}`;
      const source = {
        path,
        format: input.format,
        revision: `view-r${viewRevision++}`,
        document: input.document,
      };
      viewSources.set(path, source);
      return valid(structuredClone(source));
    },
  );
  const updateViewSource = vi.fn(
    async (input: { path: string; document: string; if_revision?: string }) => {
      const current = viewSources.get(input.path);
      if (!current) throw new Error("View source not found.");
      if (input.if_revision !== current.revision)
        throw new Error("Revision conflict.");
      const source = {
        ...current,
        revision: `view-r${viewRevision++}`,
        document: input.document,
      };
      viewSources.set(input.path, source);
      return valid(structuredClone(source));
    },
  );
  const deleteViewSource = vi.fn(
    async (input: { path: string; if_revision?: string }) => {
      const current = viewSources.get(input.path);
      if (!current) throw new Error("View source not found.");
      if (input.if_revision !== current.revision)
        throw new Error("Revision conflict.");
      viewSources.delete(input.path);
      return valid({ path: input.path, deleted: true });
    },
  );
  const connect = {
    hostedSync: () => null,
    connection: () => ({ route: "relay" }),
    describe: describeCollection,
    query,
    read,
    create,
    update,
    delete: remove,
    rename,
    listViews,
    executeView,
    readViewSource,
    createViewSource,
    updateViewSource,
    deleteViewSource,
  } as unknown as MdbaseConnection<JsonObject>;
  return {
    connect,
    describe: describeCollection,
    query,
    read,
    create,
    update,
    remove,
    rename,
    listViews,
    executeView,
    readViewSource,
    createViewSource,
    updateViewSource,
    deleteViewSource,
  };
}

function taskRecord(
  id: string,
  title: string,
  revision: string,
): RecordResult<JsonObject> {
  const task = new TaskNotesTaskModel().create(
    { title },
    { id, now: "2026-07-22T00:00:00.000Z" },
  );
  return {
    path: task.path,
    frontmatter: structuredClone(task.frontmatter) as JsonObject,
    body: task.body,
    types: ["task"],
    revision,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function description(
  templating = false,
  archive = false,
  collectionId = crypto.randomUUID(),
): CollectionDescription {
  const generated = buildTaskNotesMdbaseResources({ profiles: ["core-lite"] });
  const type = generated.type as unknown as {
    schema: { value: JsonObject };
    collection?: JsonObject;
    "x-tasknotes": JsonObject;
  };
  const configuration = structuredClone(type["x-tasknotes"]);
  if (templating)
    configuration.templating = {
      enabled: true,
      template_path: "Templates/Task.md",
      failure_mode: "error",
      unknown_variable_policy: "preserve",
    };
  if (archive)
    configuration.archive = {
      move_on_archive: true,
      folder: "TaskNotes/Archive",
    };
  return {
    protocol_version: 1,
    collection_id: collectionId,
    display_name: "Local tasks",
    spec_version: "0.3.0",
    operations: [
      "describe",
      "query",
      "list_views",
      "execute_view",
      "read_view_source",
      "create_view_source",
      "update_view_source",
      "delete_view_source",
      "read",
      "create",
      "update",
      "delete",
      "rename",
    ],
    change_cursor: 0,
    types: [
      {
        name: "task",
        version: 1,
        schema: type.schema.value,
        collection: type.collection,
        extensions: { "x-tasknotes": configuration },
      },
    ],
    contracts: [
      {
        id: "tasknotes.task",
        version: 1,
        type_name: "task",
        extension: "x-tasknotes",
        configuration,
      },
    ],
  };
}

function valid<Result>(result: Result): MdbaseOperationEnvelope<Result> {
  return { valid: true, result, diagnostics: [] };
}
