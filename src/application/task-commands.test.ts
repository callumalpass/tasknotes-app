import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskCommandService } from "./task-commands";

import type { Task, UpdateTaskInput } from "../domain/task";
import type { DurableTaskCommand, MutationJournal } from "./mutation-journal";

describe("TaskCommandService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T00:00:00.000Z"));
  });

  afterEach(() => vi.useRealTimers());

  it("persists deletion intent before publishing it and removes it on undo", async () => {
    const journal = new MemoryMutationJournal();
    const repository = taskRepository();
    const service = new TaskCommandService({ repository, journal });
    await service.initialize();

    await service.requestDeletion("task-1");

    expect(service.snapshot().pendingDeletion).toMatchObject({
      taskId: "task-1",
      title: "Durable task",
    });
    expect(journal.commands).toHaveLength(1);
    expect(repository.delete).not.toHaveBeenCalled();

    await service.undoDeletion();

    expect(service.snapshot().pendingDeletion).toBeNull();
    expect(journal.commands).toEqual([]);
    expect(repository.delete).not.toHaveBeenCalled();
    service.dispose();
  });

  it("commits the durable deletion after the undo window", async () => {
    const journal = new MemoryMutationJournal();
    const repository = taskRepository();
    const onDeleted = vi.fn(async () => undefined);
    const service = new TaskCommandService({
      repository,
      journal,
      onDeleted,
    });
    await service.initialize();
    await service.requestDeletion("task-1");

    await vi.advanceTimersByTimeAsync(30_000);

    expect(repository.delete).toHaveBeenCalledWith("task-1");
    expect(onDeleted).toHaveBeenCalledWith("task-1");
    expect(journal.commands).toEqual([]);
    expect(service.snapshot().pendingDeletion).toBeNull();
    service.dispose();
  });

  it("restores a pending deletion after restart", async () => {
    const journal = new MemoryMutationJournal();
    const repository = taskRepository();
    const first = new TaskCommandService({ repository, journal });
    await first.initialize();
    await first.requestDeletion("task-1");
    first.dispose();

    await vi.advanceTimersByTimeAsync(2_000);
    const reopened = new TaskCommandService({ repository, journal });
    await reopened.initialize();

    expect(reopened.snapshot().pendingDeletion).toMatchObject({
      taskId: "task-1",
    });
    await vi.advanceTimersByTimeAsync(28_000);
    expect(repository.delete).toHaveBeenCalledOnce();
    expect(journal.commands).toEqual([]);
    reopened.dispose();
  });

  it("retains failed deletion intent for retry", async () => {
    const journal = new MemoryMutationJournal();
    const repository = taskRepository();
    repository.delete.mockRejectedValueOnce(new Error("Storage unavailable"));
    const service = new TaskCommandService({ repository, journal });
    await service.initialize();
    await service.requestDeletion("task-1");

    await vi.advanceTimersByTimeAsync(30_000);

    expect(service.snapshot()).toMatchObject({
      pendingDeletion: { taskId: "task-1" },
      deletionError: {
        code: "unavailable",
        detail: "Storage unavailable",
        retryable: true,
      },
    });
    expect(journal.commands).toHaveLength(1);

    await service.retryDeletion();
    expect(service.snapshot().pendingDeletion).toBeNull();
    expect(journal.commands).toEqual([]);
    service.dispose();
  });

  it("replays a partially failed task batch after restart", async () => {
    const journal = new MemoryMutationJournal();
    const repository = taskRepository();
    repository.update
      .mockResolvedValueOnce({ id: "task-1", title: "First" } as Task)
      .mockRejectedValueOnce(new Error("Storage interrupted"));
    const first = new TaskCommandService({ repository, journal });
    await first.initialize();

    await expect(
      first.updateTasks([
        { id: "task-1", input: { sortOrder: "tnabcdefghij" } },
        { id: "task-2", input: { sortOrder: "tnbcdefghijk" } },
      ]),
    ).rejects.toThrow("Storage interrupted");
    expect(journal.commands).toHaveLength(1);
    first.dispose();

    repository.update.mockResolvedValue({
      id: "task-replayed",
      title: "Replayed",
    } as Task);
    const reopened = new TaskCommandService({ repository, journal });
    await reopened.initialize();

    expect(repository.update).toHaveBeenCalledTimes(4);
    expect(journal.commands).toEqual([]);
    reopened.dispose();
  });

  it("exposes failed recovery and retries it without accepting a newer batch", async () => {
    const journal = new MemoryMutationJournal();
    await journal.put({
      kind: "update-tasks",
      operationId: "waiting-batch",
      collectionId: "local:test-collection",
      requestedAt: Date.now(),
      updates: [{ id: "task-1", input: { status: "done" } }],
    });
    const repository = taskRepository();
    repository.update.mockRejectedValueOnce(new Error("Network unavailable"));
    const service = new TaskCommandService({ repository, journal });

    await service.initialize();

    expect(service.snapshot()).toMatchObject({
      pendingRecoveryCount: 1,
      recoveryError: { code: "unavailable", retryable: true },
    });
    repository.update.mockResolvedValue({
      id: "task-1",
      title: "Recovered",
    } as Task);
    await service.retryRecovery();
    expect(service.snapshot()).toMatchObject({
      pendingRecoveryCount: 0,
      recoveryError: null,
    });
    expect(journal.commands).toEqual([]);
    service.dispose();
  });
});

class MemoryMutationJournal implements MutationJournal {
  commands: DurableTaskCommand[] = [];

  async list(collectionId: string): Promise<DurableTaskCommand[]> {
    return this.commands
      .filter((command) => command.collectionId === collectionId)
      .map((command) => structuredClone(command));
  }

  async put(command: DurableTaskCommand): Promise<void> {
    this.commands = [
      ...this.commands.filter(
        (candidate) => candidate.operationId !== command.operationId,
      ),
      structuredClone(command),
    ];
  }

  async remove(operationId: string): Promise<void> {
    this.commands = this.commands.filter(
      (command) => command.operationId !== operationId,
    );
  }
}

function taskRepository() {
  const task = {
    id: "task-1",
    title: "Durable task",
  } as Task;
  const repository = {
    get: vi.fn(async (id: string) => (id === task.id ? task : null)),
    delete: vi.fn(async () => undefined),
    update: vi.fn(async (id: string, input: UpdateTaskInput) => {
      void input;
      return { ...task, id };
    }),
    collectionInfo: vi.fn(async () => ({
      kind: "local" as const,
      id: "test-collection",
      name: "Test",
      location: "Memory",
      runtime: "browser" as const,
    })),
  };
  return {
    ...repository,
    updateMany: vi.fn(
      async (updates: readonly { id: string; input: UpdateTaskInput }[]) => {
        const tasks: Task[] = [];
        for (const { id, input } of updates)
          tasks.push(await repository.update(id, input));
        return tasks;
      },
    ),
  };
}
