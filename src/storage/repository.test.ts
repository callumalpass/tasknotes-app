import "fake-indexeddb/auto";
import {
  parseFrontmatter,
  serializeMarkdownDocument,
} from "@tasknotes/model/frontmatter";
import { buildTaskNotesMdbaseResources } from "@tasknotes/model/mdbase";

import { MarkdownCollection } from "./collection";
import { todayString } from "../domain/task";
import { TaskIndex } from "./index";
import { IndexedMarkdownRepository } from "./repository";
import {
  pendingTaskDelete,
  pendingTaskMove,
  pendingTaskWrite,
} from "./mutation-outbox";
import { MemoryVault } from "../test/memory-vault";

import type { Task } from "../domain/task";
import type { IndexedTask } from "./index";

describe("IndexedMarkdownRepository", () => {
  let vault: MemoryVault;
  let index: TaskIndex;
  let repository: IndexedMarkdownRepository;

  beforeEach(async () => {
    vault = new MemoryVault();
    index = new TaskIndex(`tasknotes-test-${crypto.randomUUID()}`);
    repository = new IndexedMarkdownRepository({
      collection: new MarkdownCollection(vault),
      index,
    });
    await repository.initialize();
  });

  afterEach(async () => {
    index.close();
    await index.delete();
  });

  it("persists portable Markdown through create, edit, search, and completion", async () => {
    const created = await repository.create({
      title: "Review storage plan",
      priority: "high",
      body: "Keep this note.",
    });
    expect(created.path).toMatch(/^tasks\/\d{14}\.md$/);
    expect(await repository.list({ search: "storage" })).toHaveLength(1);

    const updated = await repository.update(created.id, {
      title: "Review native storage plan",
      due: "2026-07-24",
    });
    expect(updated.revision).toBe(2);
    expect(updated.body).toBe("Keep this note.");

    const completed = await repository.toggle(created.id);
    expect(completed.completed).toBe(true);
    expect((await repository.stats()).completed).toBe(1);

    const source = await vault.readText(created.path);
    const parsed = parseFrontmatter(source);
    expect(parsed.frontmatter).toMatchObject({
      type: "task",
      id: created.id,
      title: "Review native storage plan",
      status: "done",
      due: "2026-07-24",
      mobileRevision: 3,
    });
    expect(parsed.body).toBe("Keep this note.");
  });

  it("replays a durable write after the Markdown write is interrupted", async () => {
    const created = await repository.create({ title: "Original title" });
    const name = index.name;
    const writeText = vi
      .spyOn(vault, "writeText")
      .mockRejectedValueOnce(new Error("simulated storage interruption"));

    await expect(
      repository.update(created.id, { title: "Recovered title" }),
    ).rejects.toThrow("simulated storage interruption");
    expect(await index.mutations.get(created.id)).toMatchObject({
      taskId: created.id,
      kind: "write",
      attempts: 1,
      lastError: "simulated storage interruption",
      task: { title: "Recovered title", revision: 2 },
    });
    expect(await repository.syncStatus()).toMatchObject({ pending: 1 });
    writeText.mockRestore();
    index.close();

    index = new TaskIndex(name);
    repository = new IndexedMarkdownRepository({
      collection: new MarkdownCollection(vault),
      index,
    });
    await repository.initialize();

    expect(await repository.get(created.id)).toMatchObject({
      title: "Recovered title",
      revision: 2,
    });
    expect(await index.mutations.count()).toBe(0);
    expect(
      parseFrontmatter(await vault.readText(created.path)).frontmatter,
    ).toMatchObject({
      title: "Recovered title",
      mobileRevision: 2,
    });
  });

  it("coalesces queued writes to the latest desired task revision", async () => {
    const created = await repository.create({ title: "First revision" });
    await index.mutations.put(
      pendingTaskWrite({ ...created, title: "Queued revision" }),
    );
    await index.mutations.put(
      pendingTaskWrite({
        ...created,
        title: "Latest queued revision",
        revision: created.revision + 1,
      }),
    );

    expect(await index.mutations.count()).toBe(1);
    expect(await index.mutations.get(created.id)).toMatchObject({
      kind: "write",
      task: {
        title: "Latest queued revision",
        revision: created.revision + 1,
      },
    });
  });

  it("repairs the projection when a write completed before its commit", async () => {
    const created = await repository.create({ title: "Before crash" });
    const originalProjection = await index.tasks.get(created.id);
    const updated = await repository.update(created.id, {
      title: "Written before crash",
    });
    await index.tasks.put(originalProjection!);
    await index.mutations.put(pendingTaskWrite(updated));
    const name = index.name;
    index.close();

    index = new TaskIndex(name);
    repository = new IndexedMarkdownRepository({
      collection: new MarkdownCollection(vault),
      index,
    });
    await repository.initialize();

    expect(await repository.get(created.id)).toMatchObject({
      title: "Written before crash",
      revision: 2,
    });
    expect(await index.mutations.count()).toBe(0);
  });

  it("replays an idempotent delete after storage is interrupted", async () => {
    const created = await repository.create({ title: "Delete after restart" });
    const name = index.name;
    const remove = vi
      .spyOn(vault, "delete")
      .mockRejectedValueOnce(new Error("simulated delete interruption"));

    await expect(repository.delete(created.id)).rejects.toThrow(
      "simulated delete interruption",
    );
    expect(await index.mutations.get(created.id)).toMatchObject({
      kind: "delete",
      path: created.path,
      attempts: 1,
    });
    remove.mockRestore();
    index.close();

    index = new TaskIndex(name);
    repository = new IndexedMarkdownRepository({
      collection: new MarkdownCollection(vault),
      index,
    });
    await repository.initialize();

    expect(await repository.get(created.id)).toBeNull();
    expect(await vault.exists(created.path)).toBe(false);
    expect(await index.mutations.count()).toBe(0);
  });

  it("finishes a delete whose file removal completed before projection commit", async () => {
    const created = await repository.create({
      title: "Removed before restart",
    });
    await index.mutations.put(pendingTaskDelete(created));
    await vault.delete(created.path);
    const name = index.name;
    index.close();

    index = new TaskIndex(name);
    repository = new IndexedMarkdownRepository({
      collection: new MarkdownCollection(vault),
      index,
    });
    await repository.initialize();

    expect(await repository.get(created.id)).toBeNull();
    expect(await index.mutations.count()).toBe(0);
  });

  it("finishes a move whose file operation completed before projection commit", async () => {
    const created = await repository.create({ title: "Move after restart" });
    const archived = await repository.update(created.id, { archived: true });
    const destination = "archive/recovered-move.md";
    await index.mutations.put(pendingTaskMove(archived, destination));
    await vault.rename(created.path, destination);
    const name = index.name;
    index.close();

    index = new TaskIndex(name);
    repository = new IndexedMarkdownRepository({
      collection: new MarkdownCollection(vault),
      index,
    });
    await repository.initialize();

    expect(await repository.get(created.id)).toMatchObject({
      archived: true,
      path: destination,
    });
    expect(await vault.exists(created.path)).toBe(false);
    expect(await vault.exists(destination)).toBe(true);
    expect(await index.mutations.count()).toBe(0);
  });

  it("finishes a fallback move interrupted between copy and source deletion", async () => {
    const created = await repository.create({
      title: "Fallback move after restart",
    });
    const archived = await repository.update(created.id, { archived: true });
    const destination = "archive/recovered-fallback-move.md";
    const mutation = pendingTaskMove(archived, destination);
    mutation.sourceWritten = true;
    await index.mutations.put(mutation);
    await vault.writeText(destination, await vault.readText(created.path));
    const name = index.name;
    index.close();

    index = new TaskIndex(name);
    repository = new IndexedMarkdownRepository({
      collection: new MarkdownCollection(vault),
      index,
    });
    await repository.initialize();

    expect(await repository.get(created.id)).toMatchObject({
      archived: true,
      path: destination,
    });
    expect(await vault.exists(created.path)).toBe(false);
    expect(await vault.exists(destination)).toBe(true);
    expect(await index.mutations.count()).toBe(0);
  });

  it("reuses the durable task projection when collection views reopen", async () => {
    const created = await repository.create({
      title: "Warm indexed task",
      body: "Do not read this file again.",
    });
    const reopenedCollection = new MarkdownCollection(vault);
    const reopened = new IndexedMarkdownRepository({
      collection: reopenedCollection,
      index,
    });
    await reopened.initialize();
    const readText = vi.spyOn(vault, "readText");
    readText.mockClear();

    const records = await reopenedCollection.listCollectionRecords();

    expect(records).toEqual([
      expect.objectContaining({
        path: created.path,
        label: "Warm indexed task",
      }),
    ]);
    expect(readText).not.toHaveBeenCalledWith(created.path);
  });

  it("repairs and reindexes cached tasks from an older projection shape", async () => {
    const created = await repository.create({ title: "Legacy projection" });
    const stored = await index.tasks.get(created.id);
    const legacy = { ...stored } as Partial<IndexedTask>;
    delete legacy.blockedBy;
    delete legacy.reminders;
    delete legacy.timeEntries;
    delete legacy.customProperties;
    await index.tasks.put(legacy as IndexedTask);
    await index.metadata.put({
      key: "projection",
      complete: true,
      consistencyVersion: 1,
      taskShapeVersion: 0,
    });

    const reopened = new IndexedMarkdownRepository({
      collection: new MarkdownCollection(vault),
      index,
    });
    await reopened.initialize();

    expect(await reopened.get(created.id)).toMatchObject({
      blockedBy: [],
      reminders: [],
      timeEntries: [],
      customProperties: {},
    });
    expect(await reopened.relationships(created.id)).toMatchObject({
      blockedBy: [],
      blocking: [],
    });
    expect(await index.metadata.get("projection")).toMatchObject({
      complete: false,
      needsReindex: true,
      taskShapeVersion: 1,
    });

    expect(await reopened.refresh()).toMatchObject({ changed: 1 });
    expect(await index.metadata.get("projection")).toMatchObject({
      complete: true,
      needsReindex: false,
      taskShapeVersion: 1,
    });
  });

  it("skips the redundant first OPFS scan after a verified projection reopens", async () => {
    const browserVault = new MemoryVault();
    const firstCollection = new MarkdownCollection(browserVault);
    vi.spyOn(firstCollection, "identifier").mockReturnValue("browser-default");
    const name = `tasknotes-private-browser-test-${crypto.randomUUID()}`;
    const firstIndex = new TaskIndex(name);
    const first = new IndexedMarkdownRepository({
      collection: firstCollection,
      index: firstIndex,
    });
    await first.initialize();
    await first.create({ title: "Cached browser task" });
    await first.refresh();
    firstIndex.close();

    const reopenedIndex = new TaskIndex(name);
    const reopenedCollection = new MarkdownCollection(browserVault);
    vi.spyOn(reopenedCollection, "identifier").mockReturnValue(
      "browser-default",
    );
    const list = vi.spyOn(reopenedCollection, "list");
    const reopened = new IndexedMarkdownRepository({
      collection: reopenedCollection,
      index: reopenedIndex,
    });
    try {
      await reopened.initialize();

      expect(await reopened.refresh()).toMatchObject({
        scanned: 1,
        changed: 0,
        elapsedMs: 0,
      });
      expect(list).not.toHaveBeenCalled();

      await reopened.refresh();
      expect(list).toHaveBeenCalledOnce();
    } finally {
      reopenedIndex.close();
      await reopenedIndex.delete();
    }
  });

  it("opens an uncached collection before progressively indexing its tasks", async () => {
    const coldVault = new MemoryVault();
    for (let task = 1; task <= 300; task += 1)
      await coldVault.writeText(
        `tasks/external-${task}.md`,
        externalTaskDocument(task),
      );
    const coldIndex = new TaskIndex(
      `tasknotes-progressive-test-${crypto.randomUUID()}`,
    );
    const cold = new IndexedMarkdownRepository({
      collection: new MarkdownCollection(coldVault),
      index: coldIndex,
    });
    const readText = vi.spyOn(coldVault, "readText");
    try {
      await cold.initialize();

      expect(
        readText.mock.calls.filter(([path]) => path.startsWith("tasks/")),
      ).toHaveLength(0);
      expect(cold.indexingProgress()).toMatchObject({
        phase: "scanning",
        complete: false,
      });
      expect(await cold.list({ status: "all", limit: 1_000 })).toEqual([]);

      const progress: Array<{
        completed: number;
        publishTasks: boolean;
      }> = [];
      let refreshFinished = false;
      let createdBeforeRefreshFinished = false;
      let created: Promise<Task> | null = null;
      cold.subscribeIndexing((next, publishTasks) => {
        if (next.phase !== "indexing") return;
        progress.push({ completed: next.completed, publishTasks });
        if (!publishTasks || created) return;
        created = cold
          .create({ title: "Created while indexing" })
          .then((task) => {
            createdBeforeRefreshFinished = !refreshFinished;
            return task;
          });
      });

      const refreshed = await cold.refresh();
      refreshFinished = true;
      expect(await created).toMatchObject({ title: "Created while indexing" });
      expect(createdBeforeRefreshFinished).toBe(true);
      expect(refreshed).toMatchObject({ scanned: 300, changed: 300 });
      expect(progress).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ completed: 256, publishTasks: true }),
          expect.objectContaining({ completed: 300 }),
        ]),
      );
      expect(cold.indexingProgress()).toEqual({
        phase: "idle",
        completed: 300,
        total: 300,
        complete: true,
      });
      expect(await cold.list({ status: "all", limit: 1_000 })).toHaveLength(
        301,
      );
    } finally {
      coldIndex.close();
      await coldIndex.delete();
    }
  });

  it("remembers that a first projection was interrupted across restarts", async () => {
    const interruptedVault = new MemoryVault();
    await interruptedVault.writeText(
      "tasks/external.md",
      externalTaskDocument(1),
    );
    const name = `tasknotes-interrupted-test-${crypto.randomUUID()}`;
    const firstIndex = new TaskIndex(name);
    const first = new IndexedMarkdownRepository({
      collection: new MarkdownCollection(interruptedVault),
      index: firstIndex,
    });
    await first.initialize();
    await first.create({ title: "Created before restart" });
    expect(await firstIndex.metadata.get("projection")).toMatchObject({
      key: "projection",
      complete: false,
    });
    firstIndex.close();

    const reopenedIndex = new TaskIndex(name);
    const reopened = new IndexedMarkdownRepository({
      collection: new MarkdownCollection(interruptedVault),
      index: reopenedIndex,
    });
    try {
      await reopened.initialize();
      expect(reopened.indexingProgress()).toMatchObject({
        phase: "scanning",
        complete: false,
      });
      expect(await reopened.list({ status: "all" })).toEqual([
        expect.objectContaining({ title: "Created before restart" }),
      ]);
    } finally {
      reopenedIndex.close();
      await reopenedIndex.delete();
    }
  });

  it("derives dependency and project inverses from the repository cache", async () => {
    const parent = await repository.create({ title: "Parent" });
    const blocker = await repository.create({ title: "Blocker" });
    const child = await repository.create({ title: "Child" });
    const link = (path: string) => `[[${path.replace(/\.md$/, "")}]]`;

    await repository.update(parent.id, {
      blockedBy: [
        {
          uid: link(blocker.path),
          reltype: "STARTTOSTART",
          gap: "P1D",
        },
      ],
    });
    await repository.update(child.id, {
      blockedBy: [
        {
          uid: link(parent.path),
          reltype: "FINISHTOSTART",
        },
      ],
      projects: [link(parent.path)],
    });

    const relationships = await repository.relationships(parent.id);
    expect(relationships.blockedBy[0]).toMatchObject({
      dependency: { reltype: "STARTTOSTART", gap: "P1D" },
      task: { id: blocker.id, title: "Blocker" },
    });
    expect(relationships.blocking.map((task) => task.id)).toEqual([child.id]);
    expect(relationships.subtasks.map((task) => task.id)).toEqual([child.id]);
  });

  it("updates portable model settings in the task type document", async () => {
    const source = parseFrontmatter(await vault.readText("_types/task.md"));
    (
      (source.frontmatter.schema as { value: { properties: object } }).value
        .properties as Record<string, unknown>
    ).client = {
      type: "string",
      description: "Keep this custom field.",
    };
    source.frontmatter["x-host"] = { keep: true };
    await vault.writeText(
      "_types/task.md",
      serializeMarkdownDocument(source.frontmatter, source.body),
    );
    await repository.refresh();

    const startedAt = performance.now();
    const configuration = await repository.updateTaskModelSettings({
      defaultStatus: "in-progress",
      defaultPriority: "high",
      recurrence: {
        maintainDueDateOffset: false,
        resetCheckboxesOnRecurrence: true,
      },
      occurrences: {
        defaultMaterialization: "rolling",
        defaultNextTrigger: "completion_or_skip",
        pastHorizon: "P2D",
        futureHorizon: "P30D",
      },
      timeTracking: { autoStopOnComplete: true },
      links: { writeFormat: "markdown" },
      archive: {
        moveOnArchive: true,
        folder: "TaskNotes/Filed",
      },
      templating: {
        enabled: true,
        templatePath: "Templates/Task.md",
      },
      statusAutomation: {
        done: { autoArchive: true, autoArchiveDelay: 15 },
      },
    });
    const elapsedMs = performance.now() - startedAt;
    const updated = parseFrontmatter(await vault.readText("_types/task.md"));

    expect(configuration).toMatchObject({
      defaults: { status: "in-progress", priority: "high" },
      recurrence: {
        maintainDueDateOffset: false,
        resetCheckboxesOnRecurrence: true,
      },
      occurrences: {
        defaultMaterialization: "rolling",
        defaultNextTrigger: "completion_or_skip",
        pastHorizon: "P2D",
        futureHorizon: "P30D",
      },
      timeTracking: { autoStopOnComplete: true },
      linkWriteFormat: "markdown",
      archive: { moveOnArchive: true, folder: "TaskNotes/Filed" },
      templating: {
        enabled: true,
        templatePath: "Templates/Task.md",
      },
    });
    expect(
      configuration.statuses.find((status) => status.value === "done"),
    ).toMatchObject({
      autoArchive: true,
      autoArchiveDelay: 15,
    });
    expect(
      (
        (updated.frontmatter.schema as { value: { properties: object } }).value
          .properties as Record<string, unknown>
      ).client,
    ).toEqual({
      type: "string",
      description: "Keep this custom field.",
    });
    expect(updated.frontmatter["x-host"]).toEqual({ keep: true });
    const updatedImplementation = (
      updated.frontmatter.implements as Array<Record<string, unknown>>
    ).find(
      (candidate) =>
        candidate.contract === "tasknotes.task" &&
        candidate.version === "0.3.0-rc.1",
    )!;
    expect(
      (
        updatedImplementation.binding as {
          status: { definitions: unknown[] };
        }
      ).status.definitions.find(
        (definition) => (definition as { value?: string }).value === "done",
      ),
    ).toMatchObject({
      auto_archive: true,
      auto_archive_delay_minutes: 15,
    });
    expect(elapsedMs).toBeLessThan(500);
  });

  it("allocates unique paths when two canonical filenames collide", async () => {
    const collection = new MarkdownCollection(vault);
    await collection.initialize();
    const now = "2026-07-26T12:34:56";
    const first = await collection.createTask({ title: "First" }, "first", now);
    await collection.write(first);
    const second = await collection.createTask(
      { title: "Second" },
      "second",
      now,
    );
    await collection.write(second);

    expect(second.path).toBe(first.path.replace(/\.md$/, "-2.md"));
    expect(await vault.exists(first.path)).toBe(true);
    expect(await vault.exists(second.path)).toBe(true);
  });

  it("reconciles externally changed, added, and removed Markdown", async () => {
    const created = await repository.create({ title: "Original" });
    const source = parseFrontmatter(await vault.readText(created.path));
    await vault.writeText(
      created.path,
      serializeMarkdownDocument(
        { ...source.frontmatter, title: "Changed outside" },
        source.body,
      ),
    );
    await vault.writeText(
      "tasks/external.md",
      `---\ntype: task\nid: external\ntitle: Added outside\nstatus: open\npriority: normal\ndateCreated: 2020-01-01T00:00:00.000Z\ndateModified: 2020-01-01T00:00:00.000Z\nmobileRevision: 1\n---\n`,
    );

    const refreshed = await repository.refresh();
    expect(refreshed.changed).toBe(2);
    expect((await repository.get(created.id))?.title).toBe("Changed outside");
    expect((await repository.get("external"))?.title).toBe("Added outside");

    await vault.delete(created.path);
    expect((await repository.refresh()).removed).toBe(1);
    expect(await repository.get(created.id)).toBeNull();
  });

  it("retains the last-good projection when a changed file cannot be read", async () => {
    const created = await repository.create({ title: "Last known good" });
    const source = parseFrontmatter(await vault.readText(created.path));
    await vault.writeText(
      created.path,
      serializeMarkdownDocument(
        { ...source.frontmatter, title: "Changed outside" },
        source.body,
      ),
    );
    const readText = vi.spyOn(vault, "readText").mockImplementation((path) => {
      if (path === created.path)
        return Promise.reject(new Error("Storage temporarily unavailable"));
      return MemoryVault.prototype.readText.call(vault, path);
    });

    await expect(repository.refresh()).rejects.toThrow(
      "Storage temporarily unavailable",
    );
    expect(await repository.get(created.id)).toMatchObject({
      title: "Last known good",
    });

    readText.mockRestore();
    await expect(repository.refresh()).resolves.toMatchObject({ changed: 1 });
    expect(await repository.get(created.id)).toMatchObject({
      title: "Changed outside",
    });
  });

  it("reloads the canonical local type and applies its path and fields", async () => {
    const source = parseFrontmatter(await vault.readText("_types/task.md"));
    const schema = source.frontmatter.schema as {
      value: {
        properties: Record<string, unknown>;
        required: string[];
      };
    };
    schema.value.properties.client = {
      type: "string",
      title: "Client",
    };
    schema.value.required.push("client");
    source.frontmatter.collection = {
      path: { pattern: "canonical/{priority}/{id}.md" },
    };
    await vault.writeText(
      "_types/task.md",
      serializeMarkdownDocument(source.frontmatter, source.body),
    );

    const refreshed = await repository.refresh();
    expect(refreshed.changed).toBeGreaterThanOrEqual(0);
    expect(await repository.taskConfiguration()).toMatchObject({
      userFields: [
        expect.objectContaining({
          key: "client",
          required: true,
        }),
      ],
    });
    const created = await repository.create({
      title: "Canonical",
      priority: "high",
      customProperties: { client: "Acme" },
    });
    expect(created.path).toBe(`canonical/high/${created.id}.md`);
  });

  it("follows a custom mdbase types folder", async () => {
    const source = await vault.readText("_types/task.md");
    await vault.writeText(
      "mdbase.yaml",
      "version: 1\nsettings:\n  types_folder: definitions\n",
    );
    await vault.writeText("definitions/work-item.md", source);
    await vault.delete("_types/task.md");

    await repository.refresh();
    const created = await repository.create({ title: "Custom type folder" });
    expect(created.frontmatter.type).toBe("task");
    expect(created.path).toMatch(/^tasks\/\d{14}\.md$/);
  });

  it("asks before upgrading a managed canonical type", async () => {
    const migrationVault = new MemoryVault();
    const resources = buildTaskNotesMdbaseResources({
      profiles: ["core-lite"],
    });
    const parsed = parseFrontmatter(resources.typeDocument);
    const schema = parsed.frontmatter.schema as {
      value: { properties: Record<string, unknown> };
    };
    parsed.frontmatter.description = "A TaskNotes-compatible task.";
    schema.value.properties.mobileRevision = { type: "integer" };
    schema.value.properties.completedDate = {
      type: "string",
      format: "date-time",
    };
    const oldType = serializeMarkdownDocument(parsed.frontmatter, parsed.body);
    await migrationVault.writeText(resources.paths.type, oldType);
    await migrationVault.writeText(
      "tasks/completed.md",
      serializeMarkdownDocument(
        {
          type: "task",
          id: "completed",
          title: "Completed",
          status: "done",
          priority: "normal",
          completedDate: "2026-07-22T10:00:00Z",
          dateCreated: "2026-07-22T00:00:00Z",
          dateModified: "2026-07-22T10:00:00Z",
        },
        "",
      ),
    );
    const requests: string[] = [];
    const declined = new MarkdownCollection(migrationVault, {
      approveManagedTypeUpgrade: ({ message }) => {
        requests.push(message);
        return false;
      },
    });
    await declined.initialize();
    expect(requests).toHaveLength(1);
    expect(await migrationVault.readText(resources.paths.type)).toBe(oldType);
    await declined.refreshConfiguration();
    expect(requests).toHaveLength(1);

    const approved = new MarkdownCollection(migrationVault, {
      approveManagedTypeUpgrade: () => true,
    });
    await approved.initialize();
    expect(
      (
        parseFrontmatter(await migrationVault.readText(resources.paths.type))
          .frontmatter.schema as {
          value: { properties: { completedDate: { format: string } } };
        }
      ).value.properties.completedDate.format,
    ).toBe("date");
    expect(
      parseFrontmatter(await migrationVault.readText("tasks/completed.md"))
        .frontmatter.completedDate,
    ).toBe("2026-07-22");
  });

  it("completes project records by title and reuses indexed metadata", async () => {
    await vault.writeText(
      "Projects/mobile.md",
      "---\ntitle: Mobile roadmap\n---\nProject notes\n",
    );
    const readText = vi.spyOn(vault, "readText");
    readText.mockClear();

    await expect(
      repository.completeField({
        field: "projects",
        kind: "records",
        query: "roadmap",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        label: "Mobile roadmap",
        value: "[[Projects/mobile]]",
      }),
    ]);
    const firstReadCount = readText.mock.calls.length;

    await expect(
      repository.completeField({
        field: "projects",
        kind: "records",
        query: "mobile",
      }),
    ).resolves.toHaveLength(1);
    expect(readText).toHaveBeenCalledTimes(firstReadCount);
  });

  it("serializes concurrent mutations without losing either task", async () => {
    const [first, second] = await Promise.all([
      repository.create({ title: "First" }),
      repository.create({ title: "Second" }),
    ]);
    await Promise.all([
      repository.update(first.id, { body: "One" }),
      repository.update(second.id, { body: "Two" }),
    ]);
    expect((await repository.get(first.id))?.body).toBe("One");
    expect((await repository.get(second.id))?.body).toBe("Two");
  });

  it("keeps future-dated tasks editable when the device clock is behind", async () => {
    await vault.writeText(
      "tasks/future.md",
      `---\ntype: task\nid: future\ntitle: Future task\nstatus: open\npriority: normal\ndateCreated: 2099-01-01T10:00:00.000Z\ndateModified: 2099-01-01T10:00:00.000Z\nmobileRevision: 1\n---\n`,
    );
    await repository.refresh();
    const edited = await repository.update("future", {
      title: "Still editable",
    });
    expect(edited.updatedAt).toBe("2099-01-01T10:00:00.001Z");
  });

  it("persists TaskNotes planning, recurrence, and reminder fields", async () => {
    const created = await repository.create({
      title: "Plan release",
      tags: ["release"],
      contexts: ["computer"],
      projects: ["mdbase"],
      recurrence: "FREQ=WEEKLY;INTERVAL=1",
      recurrenceAnchor: "completion",
      reminders: [
        {
          id: "release-reminder",
          type: "absolute",
          absoluteTime: "2026-07-24T09:00:00.000Z",
        },
      ],
    });
    expect(created.projects).toEqual(["mdbase"]);
    const reopened = await repository.get(created.id);
    expect(reopened).toMatchObject({
      tags: ["release"],
      contexts: ["computer"],
      recurrenceAnchor: "completion",
    });
    const cleared = await repository.update(created.id, {
      recurrence: null,
      reminders: [],
    });
    expect(cleared.recurrence).toBeUndefined();
    expect(cleared.reminders).toEqual([]);
  });

  it("persists date-specific recurrence completion and skipping", async () => {
    const created = await repository.create({
      title: "Daily check-in",
      scheduled: "2026-08-05T09:00",
      recurrence: "FREQ=DAILY;INTERVAL=1",
    });
    const completed = await repository.toggle(created.id, "2026-08-05");
    expect(completed.completeInstances).toEqual(["2026-08-05"]);
    const skipped = await repository.skip(created.id, "2026-08-06");
    expect(skipped.skippedInstances).toEqual(["2026-08-06"]);

    const source = parseFrontmatter(await vault.readText(created.path));
    expect(source.frontmatter).toMatchObject({
      complete_instances: ["2026-08-05"],
      skipped_instances: ["2026-08-06"],
      scheduled: new Date("2026-08-07T09:00")
        .toISOString()
        .replace(".000Z", "Z"),
    });
  });

  it("materializes durable occurrence notes without duplicates and reconciles completion", async () => {
    const parent = await repository.create({
      title: "Daily durable task",
      scheduled: "2026-08-05",
      recurrence: "FREQ=DAILY;INTERVAL=1;DTSTART=20260805",
      occurrenceMaterialization: "on_completion",
      occurrenceNextTrigger: "completion_or_skip",
    });
    const first = await repository.materializeOccurrence(
      parent.id,
      "2026-08-05",
    );
    const second = await repository.materializeOccurrence(
      parent.id,
      "2026-08-05",
    );
    expect(first.created).toBe(true);
    expect(second).toMatchObject({
      created: false,
      task: { id: first.task.id },
    });
    expect(first.task).toMatchObject({
      occurrenceDate: "2026-08-05",
      recurrenceParent: `[[${parent.path.replace(/\.md$/, "")}]]`,
    });
    expect(await vault.exists(first.task.path)).toBe(true);

    const completed = await repository.toggle(first.task.id);
    expect(completed.completed).toBe(true);
    expect((await repository.get(parent.id))?.completeInstances).toContain(
      "2026-08-05",
    );
    expect(
      (await repository.list({ status: "all", limit: 100 })).filter(
        (task) => task.occurrenceDate === "2026-08-06",
      ),
    ).toHaveLength(1);
    await repository.refresh();
    expect(await repository.get(first.task.id)).toMatchObject({
      completed: true,
      occurrenceDate: "2026-08-05",
    });
    await repository.toggle(first.task.id);
    const skipped = await repository.skip(first.task.id, "2026-08-05");
    expect(skipped).toMatchObject({ skipped: true, status: "cancelled" });
    expect((await repository.get(parent.id))?.skippedInstances).toContain(
      "2026-08-05",
    );
  });

  it("maintains a finite rolling occurrence window after parent writes", async () => {
    const today = todayString();
    const parent = await repository.create({
      title: "Rolling daily task",
      scheduled: today,
      recurrence: `FREQ=DAILY;INTERVAL=1;DTSTART=${today.replaceAll("-", "")}`,
      occurrenceMaterialization: "rolling",
      occurrencePastHorizon: "P0D",
      occurrenceFutureHorizon: "P2D",
    });
    expect(parent.operationWarnings).toBeUndefined();
    const tasks = await repository.list({ status: "all", limit: 100 });
    const occurrences = tasks.filter(
      (task) => task.recurrenceParent && task.occurrenceDate,
    );
    expect(occurrences).toHaveLength(3);
    expect(new Set(occurrences.map((task) => task.occurrenceDate)).size).toBe(
      3,
    );
    await repository.update(parent.id, { body: "No duplicates" });
    expect(
      (await repository.list({ status: "all", limit: 100 })).filter(
        (task) => task.recurrenceParent && task.occurrenceDate,
      ),
    ).toHaveLength(3);
  });

  it("persists start, stop, edit, and removal of time sessions", async () => {
    const created = await repository.create({ title: "Profile indexer" });
    const started = await repository.startTimeTracking(created.id, "Benchmark");
    expect(started.timeEntries).toHaveLength(1);
    expect(started.timeEntries[0]).toMatchObject({ description: "Benchmark" });
    expect(started.timeEntries[0].endTime).toBeUndefined();
    await expect(repository.startTimeTracking(created.id)).rejects.toThrow(
      /already_active/,
    );

    const stopped = await repository.stopTimeTracking(created.id);
    expect(stopped.timeEntries[0].endTime).toMatch(/Z$/);
    const edited = await repository.replaceTimeEntries(created.id, [
      {
        startTime: "2026-07-22T09:00:00+10:00",
        endTime: "2026-07-22T10:30:00+10:00",
        description: "Measured run",
      },
    ]);
    expect(edited.timeEntries).toEqual([
      {
        startTime: "2026-07-21T23:00:00Z",
        endTime: "2026-07-22T00:30:00Z",
        description: "Measured run",
      },
    ]);
    const source = parseFrontmatter(await vault.readText(created.path));
    expect(source.frontmatter.timeEntries).toEqual(edited.timeEntries);
    expect(source.frontmatter.timeEntries).not.toHaveProperty("duration");

    const removed = await repository.removeTimeEntry(created.id, 0);
    expect(removed.timeEntries).toEqual([]);
    await expect(repository.stopTimeTracking(created.id)).rejects.toThrow(
      /no_active/,
    );
  });

  it("tracks work on multiple tasks at the same time", async () => {
    const [first, second] = await Promise.all([
      repository.create({ title: "Parallel research" }),
      repository.create({ title: "Parallel build" }),
    ]);
    const [firstStarted, secondStarted] = await Promise.all([
      repository.startTimeTracking(first.id, "Research"),
      repository.startTimeTracking(second.id, "Build"),
    ]);
    expect(firstStarted.timeEntries.at(-1)?.endTime).toBeUndefined();
    expect(secondStarted.timeEntries.at(-1)?.endTime).toBeUndefined();

    await repository.stopTimeTracking(first.id);
    expect(
      (await repository.get(first.id))?.timeEntries.at(-1)?.endTime,
    ).toMatch(/Z$/);
    expect(
      (await repository.get(second.id))?.timeEntries.at(-1)?.endTime,
    ).toBeUndefined();
  });

  it("hides archived tasks and restores them without deleting Markdown", async () => {
    const created = await repository.create({ title: "Keep for later" });
    const archived = await repository.setArchived(created.id, true);
    expect(archived.archived).toBe(true);
    expect(archived.frontmatter.tags).toContain("archived");
    expect(await repository.list({ status: "all" })).toEqual([]);
    expect(
      await repository.list({ status: "all", archived: "only" }),
    ).toHaveLength(1);
    expect(await repository.stats()).toMatchObject({
      total: 0,
      archived: 1,
    });
    expect(await vault.exists(created.path)).toBe(true);

    const restored = await repository.setArchived(created.id, false);
    expect(restored.archived).toBe(false);
    expect(await repository.list({ status: "all" })).toHaveLength(1);
    expect(await repository.stats()).toMatchObject({
      total: 1,
      archived: 0,
    });
  });

  it("moves archived files when the collection contract requests it", async () => {
    const movingVault = new MemoryVault();
    const movingIndex = new TaskIndex(`tasknotes-test-${crypto.randomUUID()}`);
    const resources = buildTaskNotesMdbaseResources();
    const type = parseFrontmatter(resources.typeDocument);
    const implementation = (
      type.frontmatter.implements as Array<Record<string, unknown>>
    ).find(
      (candidate) =>
        candidate.contract === "tasknotes.task" &&
        candidate.version === "0.3.0-rc.1",
    )!;
    const extension = implementation.binding as Record<string, unknown>;
    extension.archive = { move_on_archive: true, folder: "archive" };
    await movingVault.writeText(
      resources.paths.type,
      serializeMarkdownDocument(type.frontmatter, type.body),
    );
    const moving = new IndexedMarkdownRepository({
      collection: new MarkdownCollection(movingVault),
      index: movingIndex,
    });
    try {
      await moving.initialize();
      const created = await moving.create({ title: "Move me" });
      const archived = await moving.setArchived(created.id, true);
      expect(archived.path).toBe(created.path.replace(/^tasks\//, "archive/"));
      expect(await movingVault.exists(created.path)).toBe(false);
      expect(await movingVault.exists(archived.path)).toBe(true);
      await moving.refresh();
      expect(await moving.get(created.id)).toMatchObject({
        path: archived.path,
        archived: true,
      });

      const restored = await moving.setArchived(created.id, false);
      expect(restored.path).toBe(created.path);
      expect(await movingVault.exists(archived.path)).toBe(false);
      expect(await movingVault.exists(created.path)).toBe(true);

      const colliding = await moving.create({ title: "Do not overwrite" });
      const collisionPath = colliding.path.replace(/^tasks\//, "archive/");
      await movingVault.writeText(collisionPath, "existing archive record");
      const retained = await moving.setArchived(colliding.id, true);
      expect(retained).toMatchObject({
        path: colliding.path,
        archived: true,
        operationWarnings: [expect.stringMatching(/^archive_move_failed:/)],
      });
      expect(await movingVault.readText(collisionPath)).toBe(
        "existing archive record",
      );
      expect(await movingVault.exists(colliding.path)).toBe(true);
    } finally {
      movingIndex.close();
      await movingIndex.delete();
    }
  });
});

function externalTaskDocument(index: number): string {
  return `---
type: task
id: external-${index}
title: External task ${index}
status: open
priority: normal
dateCreated: 2026-07-27T00:00:00.000Z
dateModified: 2026-07-27T00:00:00.000Z
mobileRevision: 1
---
`;
}
