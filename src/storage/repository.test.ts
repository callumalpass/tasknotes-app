import "fake-indexeddb/auto";
import {
  parseFrontmatter,
  serializeMarkdownDocument,
} from "@tasknotes/model/frontmatter";

import { MarkdownCollection } from "./collection";
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
    expect(created.path).toBe(`tasks/${created.id}.md`);
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
});
