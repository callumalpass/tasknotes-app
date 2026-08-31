import { describe, expect, it, vi } from "vitest";

import {
  createViewDocument,
  emptyViewDraft,
  readViewDraft,
  updateViewDocument,
} from "../domain/view-document";
import { DemoTaskRepository } from "./demo-task-repository";

describe("DemoTaskRepository", () => {
  it("uses the requested task count and exposes representative saved views", async () => {
    const repository = new DemoTaskRepository(50);

    await repository.initialize();

    expect(await repository.stats()).toMatchObject({ total: 50 });
    expect(
      (await repository.listViews()).flatMap(({ views }) => views),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Today" }),
        expect.objectContaining({ name: "Calendar" }),
        expect.objectContaining({ name: "Projects" }),
        expect.objectContaining({ name: "Work board" }),
      ]),
    );
  });

  it("keeps demo mutations in memory and publishes repository changes", async () => {
    const repository = new DemoTaskRepository(4);
    const listener = vi.fn();
    repository.subscribe(listener);

    const created = await repository.create({ title: "Created in demo" });
    const updated = await repository.update(created.id, {
      priority: "high",
    });
    const completed = await repository.toggle(created.id);

    expect(updated.priority).toBe("high");
    expect(completed.completed).toBe(true);
    expect((await repository.get(created.id))?.completed).toBe(true);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("supports the scratchpad lifecycle without external storage", async () => {
    const repository = new DemoTaskRepository(2);
    const firstPage = await repository.listScratchpads({ limit: 2 });
    expect(firstPage.documents).toHaveLength(2);
    expect(firstPage.documents[0]?.state).toBe("active");
    expect(firstPage.nextCursor).toBeTruthy();
    expect(
      (await repository.listScratchpads({ cursor: firstPage.nextCursor }))
        .documents,
    ).toHaveLength(1);
    const current = await repository.getActiveScratchpad();

    const saved = await repository.saveScratchpad({
      id: current.id,
      path: current.path,
      revision: current.revision,
      baseBody: current.body,
      body: "- [ ] A fresh thought\n",
    });
    const result = await repository.archiveScratchpad({
      id: saved.id,
      path: saved.path,
      revision: saved.revision,
      baseBody: saved.body,
      body: saved.body,
      title: "Design notes",
    });

    expect(result.archived).toMatchObject({
      state: "converted",
      title: "Design notes",
    });
    expect(result.active.body).toBe("");
    expect((await repository.getScratchpad(result.archived.id))?.body).toBe(
      "- [ ] A fresh thought\n",
    );
  });

  it("applies saved-view edits to the live demo catalogue", async () => {
    const repository = new DemoTaskRepository(12);
    const today = (await repository.listViews())
      .flatMap(({ views }) => views)
      .find(({ id }) => id === "today")!;
    const source = await repository.readViewSource(today.source.path);
    const draft = readViewDraft(source, today.id);

    await repository.updateViewSource({
      path: source.path,
      ifRevision: source.revision,
      document: updateViewDocument(source, {
        ...draft,
        name: "Daily focus",
        sort: [{ property: "note.title", direction: "asc" }],
      }),
    });

    const updated = (await repository.listViews())
      .flatMap(({ views }) => views)
      .find(({ name }) => name === "Daily focus")!;
    expect(updated.id).toBe("daily-focus");
    expect(updated.sort).toEqual([
      { property: "note.title", direction: "asc" },
    ]);
    expect((await repository.executeView(updated)).rows.length).toBeGreaterThan(
      0,
    );
  });

  it("keeps advanced task settings writable for the session", async () => {
    const repository = new DemoTaskRepository(2);

    expect(await repository.taskModelSettingsAccess()).toMatchObject({
      writable: true,
    });
    await repository.updateTaskModelSettings({ defaultPriority: "high" });

    expect(
      (await repository.create({ title: "Uses the new default" })).priority,
    ).toBe("high");
  });

  it("creates and deletes session-only saved views", async () => {
    const repository = new DemoTaskRepository(8);
    const draft = {
      ...emptyViewDraft("obsidian-bases"),
      name: "Review queue",
    };
    const source = await repository.createViewSource({
      name: draft.name,
      path: "TaskNotes/Views/review-queue.base",
      format: "obsidian.base",
      document: createViewDocument("obsidian.base", draft),
    });

    expect(
      (await repository.listViews()).flatMap(({ views }) => views),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "review-queue", name: "Review queue" }),
      ]),
    );

    await repository.deleteViewSource(source.path, source.revision);
    expect(
      (await repository.listViews())
        .flatMap(({ views }) => views)
        .some(({ id }) => id === "review-queue"),
    ).toBe(false);
  });
});
