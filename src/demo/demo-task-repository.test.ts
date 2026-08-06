import { describe, expect, it, vi } from "vitest";

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
  });
});
