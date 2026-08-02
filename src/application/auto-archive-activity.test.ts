import { describe, expect, it, vi } from "vitest";

import {
  AutoArchiveActivity,
  type AutoArchiveClock,
  type AutoArchiveSchedule,
  type AutoArchiveScheduleStore,
} from "./auto-archive-activity";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";

import type { Task } from "../domain/task";
import type { TaskRepository } from "./ports/task-repository";

class MemoryScheduleStore implements AutoArchiveScheduleStore {
  schedules: AutoArchiveSchedule[] = [];
  saves = 0;

  async load() {
    return structuredClone(this.schedules);
  }

  async save(schedules: readonly AutoArchiveSchedule[]) {
    this.schedules = structuredClone([...schedules]);
    this.saves += 1;
  }
}

class ManualClock implements AutoArchiveClock {
  private nextHandle = 1;
  private timers = new Map<number, { callback: () => void; at: number }>();

  constructor(private time = Date.parse("2026-07-26T10:00:00Z")) {}

  now() {
    return this.time;
  }

  setTimeout(callback: () => void, delay: number) {
    const handle = this.nextHandle++;
    this.timers.set(handle, { callback, at: this.time + delay });
    return handle as ReturnType<typeof setTimeout>;
  }

  clearTimeout(handle: ReturnType<typeof setTimeout>) {
    this.timers.delete(handle as number);
  }

  advance(milliseconds: number) {
    this.time += milliseconds;
    const due = [...this.timers.entries()]
      .filter(([, timer]) => timer.at <= this.time)
      .sort((left, right) => left[1].at - right[1].at);
    for (const [handle, timer] of due) {
      this.timers.delete(handle);
      timer.callback();
    }
  }
}

describe("AutoArchiveActivity", () => {
  it("archives at the exact persisted deadline after a status transition", async () => {
    const task = makeTask();
    const repository = taskRepository([task]);
    const store = new MemoryScheduleStore();
    const clock = new ManualClock();
    const onArchived = vi.fn();
    const activity = new AutoArchiveActivity({
      repository,
      store,
      clock,
      configuration: autoArchiveConfiguration,
      onArchived,
    });
    await activity.start();

    task.status = "done";
    task.completed = true;
    task.revision += 1;
    await activity.observe(task);

    expect(activity.pending()).toEqual([
      expect.objectContaining({
        taskId: task.id,
        status: "done",
        revision: 2,
        updatedAt: task.updatedAt,
        archiveAt: clock.now() + 5 * 60_000,
      }),
    ]);
    clock.advance(5 * 60_000 - 1);
    await activity.reconcile();
    expect(task.archived).toBe(false);

    clock.advance(1);
    await activity.reconcile();
    expect(task.archived).toBe(true);
    expect(activity.pending()).toEqual([]);
    expect(onArchived).toHaveBeenCalledOnce();
  });

  it("cancels a pending archive when the task is reopened or made recurring", async () => {
    const task = makeTask({ status: "done", completed: true });
    const activity = new AutoArchiveActivity({
      repository: taskRepository([task]),
      store: new MemoryScheduleStore(),
      clock: new ManualClock(),
      configuration: autoArchiveConfiguration,
    });
    await activity.start();
    expect(activity.pending()).toHaveLength(1);

    task.status = "open";
    task.completed = false;
    task.revision += 1;
    await activity.observe(task);
    expect(activity.pending()).toEqual([]);

    task.status = "done";
    task.completed = true;
    task.recurrence = "FREQ=DAILY;INTERVAL=1";
    task.revision += 1;
    await activity.observe(task);
    expect(activity.pending()).toEqual([]);
  });

  it("recovers and processes an overdue schedule after restart", async () => {
    const task = makeTask({ status: "done", completed: true });
    const repository = taskRepository([task]);
    const store = new MemoryScheduleStore();
    const clock = new ManualClock();
    const first = new AutoArchiveActivity({
      repository,
      store,
      clock,
      configuration: autoArchiveConfiguration,
    });
    await first.start();
    expect(store.schedules).toHaveLength(1);
    first.dispose();

    clock.advance(6 * 60_000);
    const restarted = new AutoArchiveActivity({
      repository,
      store,
      clock,
      configuration: autoArchiveConfiguration,
    });
    await restarted.start();
    expect(task.archived).toBe(true);
    expect(store.schedules).toEqual([]);
  });

  it("restarts the debounce when a watched task revision changes", async () => {
    const task = makeTask({ status: "done", completed: true });
    const clock = new ManualClock();
    const activity = new AutoArchiveActivity({
      repository: taskRepository([task]),
      store: new MemoryScheduleStore(),
      clock,
      configuration: autoArchiveConfiguration,
    });
    await activity.start();
    const originalDeadline = activity.pending()[0]?.archiveAt;

    clock.advance(2 * 60_000);
    task.title = "Edited while done";
    task.revision += 1;
    task.updatedAt = "2026-07-26T10:02:00Z";
    await activity.reconcile();
    expect(activity.pending()[0]?.archiveAt).toBe(clock.now() + 5 * 60_000);
    expect(activity.pending()[0]?.archiveAt).toBeGreaterThan(
      originalDeadline ?? 0,
    );
  });

  it("reconciles 10,000 task events with one durable queue write", async () => {
    const tasks = Array.from({ length: 10_000 }, (_, index) =>
      makeTask({
        id: `task-${index}`,
        path: `tasks/task-${index}.md`,
        status: index % 2 ? "done" : "open",
        completed: index % 2 === 1,
      }),
    );
    const store = new MemoryScheduleStore();
    const startedAt = performance.now();
    const activity = new AutoArchiveActivity({
      repository: taskRepository(tasks),
      store,
      clock: new ManualClock(),
      configuration: autoArchiveConfiguration,
    });
    await activity.start();
    const elapsed = performance.now() - startedAt;

    expect(activity.pending()).toHaveLength(5_000);
    expect(store.saves).toBe(1);
    expect(elapsed).toBeLessThan(2_000);
    console.info(
      `auto-archive reconciliation: 10,000 tasks in ${elapsed.toFixed(1)}ms`,
    );
  });
});

function autoArchiveConfiguration() {
  const configuration = defaultTaskCollectionConfiguration();
  configuration.statuses = configuration.statuses.map((status) =>
    status.value === "done"
      ? { ...status, autoArchive: true, autoArchiveDelay: 5 }
      : { ...status, autoArchive: false },
  );
  return configuration;
}

function makeTask(patch: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    path: "tasks/task-1.md",
    title: "Test task",
    status: "open",
    completed: false,
    archived: false,
    priority: "normal",
    body: "",
    createdAt: "2026-07-26T09:00:00Z",
    updatedAt: "2026-07-26T09:00:00Z",
    tags: [],
    contexts: [],
    projects: [],
    blockedBy: [],
    completeInstances: [],
    skippedInstances: [],
    reminders: [],
    timeEntries: [],
    customProperties: {},
    revision: 1,
    frontmatter: {},
    ...patch,
  };
}

function taskRepository(tasks: Task[]): TaskRepository {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return {
    list: async () => [...byId.values()],
    get: async (id: string) => byId.get(id) ?? null,
    setArchived: async (id: string, archived: boolean) => {
      const task = byId.get(id);
      if (!task) throw new Error("Task not found.");
      task.archived = archived;
      task.revision += 1;
      return task;
    },
  } as unknown as TaskRepository;
}
