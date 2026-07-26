import type { Task } from "./task";
import type { TaskCollectionConfiguration } from "./task-configuration";
import type { TaskRepository } from "../storage/repository";

const MINUTE_MS = 60_000;
const MAX_TIMEOUT_MS = 2_147_000_000;
const STORAGE_PREFIX = "tasknotes:auto-archive:v1";

export interface AutoArchiveSchedule {
  taskId: string;
  status: string;
  revision: number;
  updatedAt: string;
  archiveAt: number;
}

export interface AutoArchiveScheduleStore {
  load(): Promise<AutoArchiveSchedule[]>;
  save(schedules: readonly AutoArchiveSchedule[]): Promise<void>;
}

export interface AutoArchiveClock {
  now(): number;
  setTimeout(
    callback: () => void,
    delay: number,
  ): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

export interface AutoArchiveActivityOptions {
  repository: TaskRepository;
  configuration(): TaskCollectionConfiguration;
  store: AutoArchiveScheduleStore;
  clock?: AutoArchiveClock;
  onArchived?(task: Task): void | Promise<void>;
  onError?(error: Error): void;
}

/**
 * Durable, event-driven auto-archive coordination for app repositories.
 *
 * Task mutations and repository watch events reconcile this activity. It keeps
 * one exact timer for the earliest persisted deadline, rather than polling.
 * Before writing, it re-reads the task and validates status and revision so a
 * delayed activity can never archive a task after it was reopened or edited.
 */
export class AutoArchiveActivity {
  private readonly repository: TaskRepository;
  private readonly configuration: () => TaskCollectionConfiguration;
  private readonly store: AutoArchiveScheduleStore;
  private readonly clock: AutoArchiveClock;
  private readonly onArchived?: (task: Task) => void | Promise<void>;
  private readonly onError: (error: Error) => void;
  private schedules = new Map<string, AutoArchiveSchedule>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tail: Promise<void> = Promise.resolve();
  private started = false;
  private disposed = false;

  constructor(options: AutoArchiveActivityOptions) {
    this.repository = options.repository;
    this.configuration = options.configuration;
    this.store = options.store;
    this.clock = options.clock ?? systemAutoArchiveClock;
    this.onArchived = options.onArchived;
    this.onError =
      options.onError ??
      ((error) => console.warn("Auto-archive activity failed.", error));
  }

  start(): Promise<void> {
    return this.enqueue(async () => {
      if (this.started || this.disposed) return;
      this.started = true;
      const stored = await this.store.load();
      this.schedules = new Map(
        stored
          .filter(validSchedule)
          .map((schedule) => [schedule.taskId, schedule]),
      );
      await this.reconcileUnlocked();
    });
  }

  observe(task: Task): Promise<void> {
    return this.enqueue(async () => {
      const changed = this.observeUnlocked(task);
      if (changed) await this.persistUnlocked();
      await this.processDueUnlocked();
      this.armTimerUnlocked();
    });
  }

  forget(taskId: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.schedules.delete(taskId)) await this.persistUnlocked();
      this.armTimerUnlocked();
    });
  }

  reconcile(): Promise<void> {
    return this.enqueue(() => this.reconcileUnlocked());
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  /** Exposed for diagnostics and focused tests. */
  pending(): AutoArchiveSchedule[] {
    return [...this.schedules.values()].sort(
      (left, right) => left.archiveAt - right.archiveAt,
    );
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const run = this.tail.then(operation, operation);
    this.tail = run.catch((reason: unknown) => {
      this.onError(asError(reason));
    });
    return run;
  }

  private async reconcileUnlocked(): Promise<void> {
    if (this.disposed) return;
    const tasks = await this.repository.list({
      status: "all",
      archived: "include",
      limit: Number.MAX_SAFE_INTEGER,
    });
    const present = new Set(tasks.map((task) => task.id));
    let changed = false;
    for (const task of tasks) changed = this.observeUnlocked(task) || changed;
    for (const taskId of this.schedules.keys()) {
      if (!present.has(taskId)) {
        this.schedules.delete(taskId);
        changed = true;
      }
    }
    if (changed) await this.persistUnlocked();
    await this.processDueUnlocked();
    this.armTimerUnlocked();
  }

  private observeUnlocked(task: Task): boolean {
    const status = eligibleStatus(task, this.configuration());
    const existing = this.schedules.get(task.id);
    if (!status) {
      return this.schedules.delete(task.id);
    }
    if (
      existing?.status === task.status &&
      existing.revision === task.revision &&
      existing.updatedAt === task.updatedAt
    )
      return false;
    const delayMinutes = Math.max(0, status.autoArchiveDelay);
    this.schedules.set(task.id, {
      taskId: task.id,
      status: task.status,
      revision: task.revision,
      updatedAt: task.updatedAt,
      archiveAt: this.clock.now() + delayMinutes * MINUTE_MS,
    });
    return true;
  }

  private async processDueUnlocked(): Promise<void> {
    if (this.disposed) return;
    const now = this.clock.now();
    const due = [...this.schedules.values()]
      .filter((schedule) => schedule.archiveAt <= now)
      .sort((left, right) => left.archiveAt - right.archiveAt);
    if (!due.length) return;

    let changed = false;
    for (const schedule of due) {
      const current = await this.repository.get(schedule.taskId);
      if (!current) {
        changed = this.schedules.delete(schedule.taskId) || changed;
        continue;
      }
      const status = eligibleStatus(current, this.configuration());
      if (
        !status ||
        current.status !== schedule.status ||
        current.revision !== schedule.revision ||
        current.updatedAt !== schedule.updatedAt
      ) {
        changed = this.observeUnlocked(current) || changed;
        continue;
      }
      try {
        const archived = await this.repository.setArchived(current.id, true);
        changed = this.schedules.delete(current.id) || changed;
        await this.onArchived?.(archived);
      } catch (reason) {
        this.onError(asError(reason));
        schedule.archiveAt = this.clock.now() + MINUTE_MS;
        this.schedules.set(schedule.taskId, schedule);
        changed = true;
      }
    }
    if (changed) await this.persistUnlocked();
  }

  private async persistUnlocked(): Promise<void> {
    await this.store.save(this.pending());
  }

  private armTimerUnlocked(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    if (this.disposed || !this.schedules.size) return;
    const next = Math.min(
      ...[...this.schedules.values()].map((schedule) => schedule.archiveAt),
    );
    const delay = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(0, next - this.clock.now()),
    );
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      void this.enqueue(async () => {
        await this.processDueUnlocked();
        this.armTimerUnlocked();
      });
    }, delay);
  }
}

export class BrowserAutoArchiveScheduleStore implements AutoArchiveScheduleStore {
  constructor(
    private readonly key: string,
    private readonly storage: Pick<Storage, "getItem" | "setItem">,
  ) {}

  async load(): Promise<AutoArchiveSchedule[]> {
    const value = this.storage.getItem(this.key);
    if (!value) return [];
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter(validSchedule) : [];
    } catch {
      return [];
    }
  }

  async save(schedules: readonly AutoArchiveSchedule[]): Promise<void> {
    this.storage.setItem(this.key, JSON.stringify(schedules));
  }
}

export async function createRepositoryAutoArchiveActivity(
  options: Omit<AutoArchiveActivityOptions, "store"> & {
    storage?: Pick<Storage, "getItem" | "setItem">;
  },
): Promise<AutoArchiveActivity> {
  const collection = await options.repository.collectionInfo();
  const identity = `${collection.kind}:${collection.id ?? collection.location}`;
  const storage = options.storage ?? globalThis.localStorage;
  return new AutoArchiveActivity({
    ...options,
    store: new BrowserAutoArchiveScheduleStore(
      `${STORAGE_PREFIX}:${identity}`,
      storage,
    ),
  });
}

function eligibleStatus(
  task: Task,
  configuration: TaskCollectionConfiguration,
) {
  if (task.archived || task.recurrence) return undefined;
  return configuration.statuses.find(
    (status) => status.value === task.status && status.autoArchive,
  );
}

function validSchedule(value: unknown): value is AutoArchiveSchedule {
  if (!value || typeof value !== "object") return false;
  const schedule = value as Partial<AutoArchiveSchedule>;
  return (
    typeof schedule.taskId === "string" &&
    typeof schedule.status === "string" &&
    typeof schedule.revision === "number" &&
    Number.isFinite(schedule.revision) &&
    typeof schedule.updatedAt === "string" &&
    typeof schedule.archiveAt === "number" &&
    Number.isFinite(schedule.archiveAt)
  );
}

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

const systemAutoArchiveClock: AutoArchiveClock = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};
