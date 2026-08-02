import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskRepository } from "../application/ports/task-repository";

export interface TaskRepositoryContractFixture {
  repository: TaskRepository;
  cleanup?(): Promise<void> | void;
}

/** Shared behavioural contract for every local, replicated, and relay adapter. */
export function taskRepositoryContract(
  adapter: string,
  createFixture: () => Promise<TaskRepositoryContractFixture>,
): void {
  describe(`${adapter} TaskRepository contract`, () => {
    let fixture: TaskRepositoryContractFixture;

    beforeEach(async () => {
      fixture = await createFixture();
    });

    afterEach(async () => {
      await fixture.cleanup?.();
    });

    it("initializes idempotently and exposes collection capabilities", async () => {
      await fixture.repository.initialize();
      await fixture.repository.initialize();

      expect(await fixture.repository.collectionInfo()).toMatchObject({
        name: expect.any(String),
        location: expect.any(String),
      });
      expect(await fixture.repository.taskConfiguration()).toMatchObject({
        statuses: expect.any(Array),
      });
      expect(await fixture.repository.syncStatus()).toMatchObject({
        mode: expect.any(String),
        state: expect.any(String),
        pending: expect.any(Number),
        issues: expect.any(Number),
      });
    });

    it("provides consistent create, batch update, query, and idempotent delete semantics", async () => {
      const changed = vi.fn();
      const unsubscribe = fixture.repository.subscribe(changed);
      await fixture.repository.initialize();
      changed.mockClear();

      const first = await fixture.repository.create({
        title: "Contract alpha",
      });
      const second = await fixture.repository.create({
        title: "Contract beta",
      });
      expect(await fixture.repository.get(first.id)).toMatchObject({
        title: "Contract alpha",
      });

      const updated = await fixture.repository.updateMany([
        { id: first.id, input: { priority: "high" } },
        { id: second.id, input: { status: "done" } },
      ]);
      expect(updated).toHaveLength(2);
      expect(updated[0]).toMatchObject({ id: first.id, priority: "high" });
      expect(updated[1]).toMatchObject({ id: second.id, status: "done" });
      expect(await fixture.repository.list({ search: "alpha" })).toMatchObject([
        { id: first.id },
      ]);

      await fixture.repository.delete(first.id);
      await fixture.repository.delete(first.id);
      expect(await fixture.repository.get(first.id)).toBeNull();
      expect(changed).toHaveBeenCalled();
      unsubscribe();
    });
  });
}
