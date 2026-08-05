import { type JsonObject, type MdbaseConnection } from "@mdbase-dev/connect";
import { connectFailure, connectSuccess } from "@mdbase-dev/connect-testing";
import { describe, expect, it, vi } from "vitest";

import { todayString } from "../domain/task";
import { createConnectTaskRepository } from "./connect-repository";
import { MdbaseTaskRepository } from "./mdbase-repository";
import { resolveTaskCollection } from "./tasknotes-collection";
import {
  deferred,
  description,
  mdbaseFixture,
  multipleProviderDescription,
  taskRecord,
  unknownOutcome,
  type TestRecord,
} from "../test/mdbase-fixture";
import { taskRepositoryContract } from "../test/task-repository-contract";

taskRepositoryContract("direct mdbase", async () => ({
  repository: new MdbaseTaskRepository(mdbaseFixture([]).connect),
}));

describe("mdbase task repository", () => {
  it("unions multiple providers and preserves each provider's field mapping on update", async () => {
    const collection = multipleProviderDescription();
    const workId = "11111111-1111-4111-8111-111111111111";
    const workProvider = resolveTaskCollection(collection).providers.find(
      ({ typeName }) => typeName === "work_task",
    )!;
    const workTask = workProvider.model.create(
      { title: "Mapped work task" },
      { id: workId, now: "2026-07-22T00:00:00.000Z" },
    );
    const fixture = mdbaseFixture(
      [
        taskRecord("personal-one", "Personal task", "r1"),
        {
          path: workTask.path,
          frontmatter: structuredClone(workTask.frontmatter) as JsonObject,
          body: workTask.body,
          types: ["work_task"],
          revision: "r2",
        },
      ],
      false,
      false,
      collection.collectionId as ReturnType<typeof crypto.randomUUID>,
    );
    fixture.describe.mockResolvedValue(collection);
    const repository = new MdbaseTaskRepository(fixture.connect);

    await repository.initialize();
    expect((await repository.list()).map(({ title }) => title).sort()).toEqual([
      "Mapped work task",
      "Personal task",
    ]);

    const updated = await repository.update(workId, {
      title: "Mapped work task updated",
    });
    expect(updated.title).toBe("Mapped work task updated");
    expect(fixture.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({ summary: "Mapped work task updated" }),
      }),
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(fixture.update.mock.calls.at(-1)?.[0].patch).not.toHaveProperty(
      "title",
    );

    await repository.create({ title: "Created deterministically" });
    expect(fixture.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "task" }),
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("loads canonical effective-frontmatter query rows", async () => {
    const fixture = mdbaseFixture([
      taskRecord("canonical", "Visible canonical task", "r1"),
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);

    await repository.initialize();

    expect(await repository.list()).toMatchObject([
      { id: "canonical", title: "Visible canonical task" },
    ]);
    expect(fixture.query).toHaveBeenCalledWith(
      expect.objectContaining({ frontmatterMode: "effective" }),
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("coalesces record completion into one small provider query", async () => {
    const project: TestRecord = {
      path: "Projects/Mobile.md",
      frontmatter: { title: "Mobile roadmap" },
      body: "",
      types: ["project"],
      revision: "project-r1",
    };
    const fixture = mdbaseFixture([
      taskRecord("existing", "Review relay support", "r1"),
      project,
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
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
      value: "[[Projects/Mobile|Mobile roadmap]]",
      label: "Mobile roadmap",
      detail: "Projects/Mobile.md",
      path: "Projects/Mobile.md",
    });
    expect(fixture.query).toHaveBeenCalledTimes(2);
    const completionQuery = fixture.query.mock.calls[1]?.[0];
    expect(completionQuery).toMatchObject({
      limit: 48,
      frontmatterMode: "effective",
      orderBy: [{ field: "file.path", direction: "asc" }],
    });
    expect(String(completionQuery?.where)).toContain(
      'file.path.lower().contains("mobile")',
    );
  });

  it("opens, searches, and mutates a TaskNotes collection over live operations", async () => {
    const fixture = mdbaseFixture([
      taskRecord("existing", "Review relay support", "r1"),
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);

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
      fixture.update.mock.calls.map(([input]) => input.ifRevision),
    ).toEqual(["r1", "r2"]);

    const created = await repository.create({ title: "New relay task" });
    expect(created.title).toBe("New relay task");
    expect(created.path).toMatch(/^tasks\/\d{14}\.md$/);
    expect(created.frontmatter.id).toBe(created.id);
    await repository.delete(created.id);
    expect(await repository.get(created.id)).toBeNull();
    expect(fixture.remove).toHaveBeenCalledWith(
      expect.objectContaining({ ifRevision: "r4" }),
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(await repository.connectionStatus()).toMatchObject({
      state: "connected",
    });
  });

  it("serializes writes to different tasks across the live connection", async () => {
    const fixture = mdbaseFixture([
      taskRecord("first", "First task", "r1"),
      taskRecord("second", "Second task", "r2"),
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    const releaseFirst = deferred<void>();
    const persist = fixture.update.getMockImplementation()!;
    fixture.update.mockImplementationOnce(async (input) => {
      await releaseFirst.promise;
      return persist(input);
    });

    const first = repository.update("first", { title: "First moved" });
    await vi.waitFor(() => expect(fixture.update).toHaveBeenCalledTimes(1));
    const second = repository.update("second", { title: "Second moved" });
    await Promise.resolve();

    expect(fixture.update).toHaveBeenCalledTimes(1);
    releaseFirst.resolve();
    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { title: "First moved" },
      { title: "Second moved" },
    ]);
    expect(fixture.update).toHaveBeenCalledTimes(2);
  });

  it("publishes one repository change for a 200-task manual-order rewrite", async () => {
    const records = Array.from({ length: 200 }, (_, index) =>
      taskRecord(`task-${index}`, `Manual task ${index}`, `r${index + 1}`),
    );
    const fixture = mdbaseFixture(records);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    const listener = vi.fn();
    repository.subscribe(listener);

    const tasks = await repository.updateMany(
      records.map((record, index) => ({
        id: String(record.frontmatter.id),
        input: {
          sortOrder: `tn${String(index).padStart(10, "a")}`,
        },
      })),
    );

    expect(tasks).toHaveLength(200);
    expect(fixture.update).toHaveBeenCalledTimes(200);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("recovers an unknown live write by its exact authority request", async () => {
    const fixture = mdbaseFixture([
      taskRecord("existing", "Original title", "r1"),
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    const persist = fixture.update.getMockImplementation()!;
    let recovery: ReturnType<typeof fixture.stagePendingMutation> | undefined;
    fixture.update.mockImplementationOnce(async (input) => {
      recovery = fixture.stagePendingMutation("fixture-request", async () => {
        const envelope = await persist(input);
        if (!envelope.valid) throw new Error("Fixture update was invalid.");
        return connectSuccess(envelope.result);
      });
      throw unknownOutcome();
    });

    await expect(
      repository.update("existing", { title: "Recovered title" }),
    ).resolves.toMatchObject({ title: "Recovered title" });

    expect(fixture.update).toHaveBeenCalledOnce();
    expect(recovery?.recover).toHaveBeenCalledOnce();
  });

  it("recovers a pending live write before sending a later task change", async () => {
    const fixture = mdbaseFixture([
      taskRecord("first", "First task", "r1"),
      taskRecord("second", "Second task", "r2"),
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    const persist = fixture.update.getMockImplementation()!;
    let recovery: ReturnType<typeof fixture.stagePendingMutation> | undefined;
    fixture.update.mockImplementationOnce(async (input) => {
      let attempt = 0;
      recovery = fixture.stagePendingMutation("fixture-request", async () => {
        attempt += 1;
        if (attempt === 1) return connectFailure(unknownOutcome().problem);
        const envelope = await persist(input);
        if (!envelope.valid) throw new Error("Fixture update was invalid.");
        return connectSuccess(envelope.result);
      });
      throw unknownOutcome();
    });

    await expect(
      repository.update("first", { title: "First recovered" }),
    ).rejects.toMatchObject({ code: "operation_outcome_unknown" });
    await expect(
      repository.update("second", { title: "Second moved" }),
    ).resolves.toMatchObject({ title: "Second moved" });

    expect(fixture.update).toHaveBeenCalledTimes(2);
    expect(fixture.update.mock.calls[1]![0]).not.toBe(
      fixture.update.mock.calls[0]![0],
    );
    expect(recovery?.recover).toHaveBeenCalledTimes(2);
  });

  it("reloads the canonical description and sends its create path to the provider", async () => {
    const collectionId = crypto.randomUUID();
    const fixture = mdbaseFixture([], false, false, collectionId);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    const next = description(false, false, collectionId);
    next.types[0] = {
      ...next.types[0],
      name: "todo",
      collection: { path: { pattern: "canonical/{id}.md" } },
    };
    next.contracts[0] = {
      ...next.contracts[0],
      implementations: next.contracts[0].implementations.map(
        (implementation) => ({ ...implementation, typeName: "todo" }),
      ),
    };
    fixture.describe.mockResolvedValueOnce(next);

    await repository.refresh();
    const created = await repository.create({ title: "Provider path" });

    expect(created.frontmatter.type).toBe("todo");
    expect(created.path).toBe(`canonical/${created.id}.md`);
    expect(fixture.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: `canonical/${created.id}.md`,
        type: "todo",
      }),
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("falls back to portable TaskNotes filename settings", async () => {
    const collectionId = crypto.randomUUID();
    const fixture = mdbaseFixture([], false, false, collectionId);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    const next = description(false, false, collectionId);
    const configuration = structuredClone(
      next.contracts[0]!.implementations[0].binding!,
    );
    configuration.title = {
      storage: "frontmatter",
      filename_format: "custom",
      custom_filename_template: "{{titleKebab}}",
    };
    next.types[0] = {
      ...next.types[0]!,
      collection: {},
      definition: {
        ...next.types[0]!.definition,
        implements: [
          {
            contract: "tasknotes.task",
            version: "0.3.0-rc.3",
            fields: next.contracts[0]!.implementations[0].fields,
            binding: configuration,
          },
        ],
      },
      extensions: {},
    };
    next.contracts[0] = {
      ...next.contracts[0]!,
      implementations: [
        {
          ...next.contracts[0]!.implementations[0],
          binding: configuration,
        },
      ],
    };
    fixture.describe.mockResolvedValueOnce(next);

    await repository.refresh();
    const created = await repository.create({
      title: "Review mobile release",
    });

    expect(created.path).toBe("tasks/review-mobile-release.md");
    expect(fixture.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "tasks/review-mobile-release.md" }),
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("allocates unique live paths when canonical filenames collide", async () => {
    const collectionId = crypto.randomUUID();
    const fixture = mdbaseFixture([], false, false, collectionId);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    const next = description(false, false, collectionId);
    next.types[0] = {
      ...next.types[0]!,
      collection: { path: { pattern: "tasks/shared.md" } },
    };
    fixture.describe.mockResolvedValueOnce(next);
    await repository.refresh();

    const [first, second] = await Promise.all([
      repository.create({ title: "First" }),
      repository.create({ title: "Second" }),
    ]);

    expect([first.path, second.path]).toEqual([
      "tasks/shared.md",
      "tasks/shared-2.md",
    ]);
    expect(first.id).not.toBe(second.id);
  });

  it("prefetches one revision read and reuses it for a later delete", async () => {
    const fixture = mdbaseFixture([
      taskRecord("delete-me", "Delete without a second wait", "r1"),
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();

    await repository.get("delete-me");
    await repository.delete("delete-me");

    expect(fixture.read).toHaveBeenCalledTimes(1);
    expect(fixture.remove).toHaveBeenCalledWith(
      expect.objectContaining({ ifRevision: "r1" }),
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("keeps the current session readable when a refresh cannot reach the connector", async () => {
    const fixture = mdbaseFixture([
      taskRecord("cached", "Visible while unavailable", "r1"),
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    fixture.query.mockRejectedValueOnce(
      new TypeError("The computer is unavailable."),
    );

    const refreshed = await repository.refresh();

    expect(refreshed.scanned).toBe(1);
    expect(await repository.get("cached")).toMatchObject({
      title: "Visible while unavailable",
    });
    expect(await repository.connectionStatus()).toMatchObject({
      state: "unavailable",
    });
  });

  it("aborts active foreground work on suspend and resumes with a fresh signal", async () => {
    const fixture = mdbaseFixture([
      taskRecord("existing", "Still visible", "r1"),
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    let activeSignal: AbortSignal | undefined;
    fixture.describe.mockImplementationOnce(
      (options?: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          activeSignal = options?.signal;
          activeSignal?.addEventListener(
            "abort",
            () => reject(activeSignal?.reason),
            { once: true },
          );
        }),
    );

    const interrupted = repository.refresh();
    await vi.waitFor(() => expect(activeSignal).toBeDefined());
    repository.suspend();

    await expect(interrupted).resolves.toMatchObject({ scanned: 1 });
    expect(activeSignal?.aborted).toBe(true);
    expect(await repository.connectionStatus()).toMatchObject({
      state: "unavailable",
    });

    repository.resume();
    await expect(repository.refresh()).resolves.toMatchObject({ scanned: 1 });
    expect(await repository.connectionStatus()).toMatchObject({
      state: "connected",
    });
  });

  it("restarts initialization after a lifecycle remount cancels the first attempt", async () => {
    const fixture = mdbaseFixture([
      taskRecord("existing", "Visible after remount", "r1"),
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
    let firstSignal: AbortSignal | undefined;
    fixture.describe.mockImplementationOnce(
      (options?: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          firstSignal = options?.signal;
          firstSignal?.addEventListener(
            "abort",
            () => reject(firstSignal?.reason),
            {
              once: true,
            },
          );
        }),
    );

    const interrupted = repository.initialize();
    await vi.waitFor(() => expect(firstSignal).toBeDefined());
    repository.dispose();
    repository.resume();

    await expect(interrupted).rejects.toMatchObject({ name: "AbortError" });
    await expect(repository.initialize()).resolves.toBeUndefined();
    await expect(repository.list()).resolves.toMatchObject([
      { id: "existing", title: "Visible after remount" },
    ]);
    expect(fixture.describe).toHaveBeenCalledTimes(2);
  });

  it("round-trips time sessions through revision-guarded relay writes", async () => {
    const fixture = mdbaseFixture([
      taskRecord("timed", "Profile the relay", "r1"),
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
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
      fixture.update.mock.calls.map(([input]) => input.ifRevision),
    ).toEqual(["r1", "r2", "r3", "r4"]);
  });

  it("creates one durable relay occurrence and reconciles its parent", async () => {
    const parent = taskRecord("series", "Relay recurrence", "r1");
    parent.frontmatter.scheduled = "2026-08-05";
    parent.frontmatter.recurrence = "FREQ=DAILY;INTERVAL=1;DTSTART=20260805";
    const fixture = mdbaseFixture([parent]);
    const repository = new MdbaseTaskRepository(fixture.connect);
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
    const fixture = mdbaseFixture([parent]);
    const repository = new MdbaseTaskRepository(fixture.connect);

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
    const fixture = mdbaseFixture(
      [taskRecord("archived", "Relay archive", "r1")],
      false,
      true,
    );
    const repository = new MdbaseTaskRepository(fixture.connect);
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
    expect(fixture.rename).toHaveBeenLastCalledWith(
      {
        from: "tasks/archived.md",
        to: "TaskNotes/Archive/archived.md",
        ifRevision: "r2",
        update_refs: true,
      },
      expect.objectContaining({ signal: expect.anything() }),
    );

    const restored = await repository.setArchived("archived", false);
    expect(restored).toMatchObject({
      archived: false,
      path: "tasks/archived.md",
    });
    expect(await repository.list({ status: "all" })).toHaveLength(1);
  });

  it("lists and executes provider-owned saved views", async () => {
    const fixture = mdbaseFixture([
      taskRecord("board", "Visible on the board", "r1"),
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
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
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("coalesces concurrent executions of the same saved view", async () => {
    const fixture = mdbaseFixture([
      taskRecord("board", "Visible on the board", "r1"),
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
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

  it("keeps the last view result in memory during a transient failure", async () => {
    const fixture = mdbaseFixture([
      taskRecord("cached", "Cached mdbase task", "r1"),
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    const [document] = await repository.listViews();
    const view = document.views[0];
    const execution = await repository.executeView(view);

    fixture.listViews.mockRejectedValue(new Error("Still refreshing"));
    fixture.executeView.mockRejectedValue(new Error("Still refreshing"));

    expect((await repository.listViews())[0].views[0].name).toBe("Kanban");
    expect(await repository.cachedViewExecution(view)).toEqual(execution);
    expect((await repository.executeView(view)).stale).toBe(true);
  });

  it("does not publish repeated state changes for the same operation failure", async () => {
    const fixture = mdbaseFixture([]);
    const connect = {
      ...fixture.connect,
      readViewSource: undefined,
    } as unknown as MdbaseConnection<JsonObject>;
    const repository = new MdbaseTaskRepository(connect);
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
    const fixture = mdbaseFixture([]);
    const repository = new MdbaseTaskRepository(fixture.connect);
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
      expect.objectContaining({ ifRevision: "view-r2" }),
      expect.objectContaining({ signal: expect.anything() }),
    );

    await repository.deleteViewSource(updated.path, updated.revision);
    expect(fixture.deleteViewSource).toHaveBeenCalledWith(
      {
        path: updated.path,
        ifRevision: "view-r3",
      },
      expect.objectContaining({ signal: expect.anything() }),
    );
    await expect(repository.readViewSource(updated.path)).rejects.toThrow(
      "View source not found",
    );
    expect(fixture.listViews).not.toHaveBeenCalled();
  });

  it("creates from the configured template through the direct mdbase", async () => {
    const fixture = mdbaseFixture(
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
    const repository = new MdbaseTaskRepository(fixture.connect);
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
    expect(fixture.read).toHaveBeenCalledWith(
      { path: "Templates/Task.md" },
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("uses one provider-neutral repository for every mdbase connection", () => {
    expect(
      createConnectTaskRepository(mdbaseFixture([]).connect),
    ).toBeInstanceOf(MdbaseTaskRepository);
  });
});
