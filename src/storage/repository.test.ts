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
import { MemoryVault } from "../test/memory-vault";

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
    const extension = type.frontmatter["x-tasknotes"] as Record<
      string,
      unknown
    >;
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
