import Dexie, { type Table } from "dexie";
import type {
  TaskRepository,
  RepositoryChange,
} from "../application/ports/task-repository";
import {
  SnapshotTaskRepository,
  type CollectionSnapshot,
} from "./snapshot-task-repository";

interface Checkpoint {
  key: string;
  revision: number;
  snapshot: CollectionSnapshot;
}
export type { TransferLedger } from "../application/ports/local-collection";
import type { TransferLedger } from "../application/ports/local-collection";
class LocalDatabase extends Dexie {
  checkpoints!: Table<Checkpoint, string>;
  transfers!: Table<TransferLedger, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      checkpoints: "&key",
      transfers: "&key,destination",
    });
  }
}
const mutations = new Set([
  "initialize",
  "refresh",
  "create",
  "update",
  "editCalendar",
  "updateMany",
  "toggle",
  "skip",
  "materializeOccurrence",
  "startTimeTracking",
  "stopTimeTracking",
  "replaceTimeEntries",
  "removeTimeEntry",
  "setArchived",
  "delete",
  "createViewSource",
  "updateViewSource",
  "deleteViewSource",
  "createScratchImage",
  "removeScratchImage",
  "getActiveScratchpad",
  "saveScratchpad",
  "startNewScratchpad",
  "reactivateScratchpad",
  "deleteScratchpad",
  "archiveScratchpad",
  "updateTaskModelSettings",
]);

/** The only guest persistence owner. A mutation runs against a staged collection,
 * then publishes its result after an atomic IndexedDB commit. Failed commits
 * leave the visible checkpoint intact. CAS prevents overwriting another tab. */
class LocalCollectionOwner {
  private readonly database: LocalDatabase;
  private current = new SnapshotTaskRepository();
  private tail: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(change?: RepositoryChange) => void>();
  private readonly channel?: BroadcastChannel;
  private closed = false;

  constructor(name = "tasknotes-local-collection-v1") {
    this.database = new LocalDatabase(name);
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(name);
      this.channel.onmessage = () => void this.reload().catch(() => undefined);
    }
    const files = new Proxy(this.current.files, {
      get: (_target, property: string) => {
        if (property === "authorizedActions")
          return () => this.current.files.authorizedActions();
        return (...args: unknown[]) => this.callFiles(property, args);
      },
    });
    return new Proxy(this, {
      get: (target, property, receiver) => {
        if (property === "files") return files;
        if (property in target) {
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        }
        const value = Reflect.get(this.current, property);
        if (typeof value !== "function") return value;
        if (
          [
            "todayTaskCounts",
            "navigationTaskCounts",
            "projectShortcuts",
          ].includes(String(property))
        )
          return value.bind(this.current);
        if (property === "iterateView") return value.bind(this.current);
        return (...args: unknown[]) =>
          this.perform(String(property), args, mutations.has(String(property)));
      },
    });
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const result = this.tail.then(run);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async checkpoint(): Promise<Checkpoint> {
    if (this.closed) throw new Error("local_collection_closed");
    const existing = await this.database.checkpoints.get("collection");
    if (existing) return existing;
    // put-if-absent and initial identity are one transaction across tabs.
    return this.database.transaction(
      "rw",
      this.database.checkpoints,
      async () => {
        const found = await this.database.checkpoints.get("collection");
        if (found) return found;
        const created = {
          key: "collection",
          revision: 0,
          snapshot: this.current.snapshot(),
        };
        await this.database.checkpoints.add(created);
        return created;
      },
    );
  }

  private async commit(
    before: Checkpoint,
    staged: SnapshotTaskRepository,
  ): Promise<void> {
    const snapshot = staged.snapshot();
    await this.database.transaction(
      "rw",
      this.database.checkpoints,
      async () => {
        const latest = await this.database.checkpoints.get("collection");
        if (latest?.revision !== before.revision)
          throw new Error("local_collection_changed_in_another_tab");
        await this.database.checkpoints.put({
          key: "collection",
          revision: before.revision + 1,
          snapshot,
        });
      },
    );
    this.current = staged;
    this.channel?.postMessage("changed");
    this.emit();
  }

  private perform(
    method: string,
    args: unknown[],
    write: boolean,
  ): Promise<unknown> {
    return this.enqueue(async () => {
      const before = await this.checkpoint();
      const staged = new SnapshotTaskRepository(before.snapshot);
      const result = await Reflect.get(staged, method).apply(staged, args);
      if (write) await this.commit(before, staged);
      else this.current = staged;
      return result;
    });
  }

  private callFiles(method: string, args: unknown[]): Promise<unknown> {
    return this.enqueue(async () => {
      const before = await this.checkpoint();
      const staged = new SnapshotTaskRepository(before.snapshot);
      const result = await Reflect.get(staged.files, method).apply(
        staged.files,
        args,
      );
      if (["upload", "move", "delete"].includes(method))
        await this.commit(before, staged);
      else this.current = staged;
      return result;
    });
  }

  async exportSnapshot(): Promise<CollectionSnapshot> {
    await this.tail;
    return structuredClone((await this.checkpoint()).snapshot);
  }
  async transfer(destination: string): Promise<TransferLedger | undefined> {
    const source = await this.exportSnapshot();
    return (
      await this.database.transfers
        .where("destination")
        .equals(destination)
        .toArray()
    ).find((ledger) => ledger.source.id === source.id && !ledger.completed);
  }
  async transferHistory(destination: string): Promise<TransferLedger[]> {
    const source = await this.exportSnapshot();
    return (
      await this.database.transfers
        .where("destination")
        .equals(destination)
        .toArray()
    )
      .filter((ledger) => ledger.source.id === source.id && ledger.completed)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
  async exclusiveTransfer<T>(
    destination: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const locks = globalThis.navigator?.locks;
    if (!locks) throw new Error("local_transfer_requires_browser_locks");
    return locks.request(
      `tasknotes-local-transfer:${destination}`,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) throw new Error("local_transfer_open_in_another_tab");
        return run();
      },
    );
  }
  async saveTransfer(ledger: TransferLedger): Promise<void> {
    await this.database.transfers.put(structuredClone(ledger));
    this.channel?.postMessage("changed");
    this.emit();
  }
  private reload(): Promise<void> {
    return this.enqueue(async () => {
      this.current = new SnapshotTaskRepository(
        (await this.checkpoint()).snapshot,
      );
      this.emit();
    });
  }
  subscribe(listener: (change?: RepositoryChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(): void {
    for (const listener of this.listeners) listener({ kind: "data" });
  }
  suspend(): void {}
  resume(): void {
    void this.reload().catch(() => undefined);
  }
  // Workspaces borrow this collection from the application owner. Connect and
  // recovery can continue using it after a workspace unmounts.
  dispose(): void {}
  close(): void {
    // Accepted work drains before closing; navigating into Connect cannot cancel it.
    void this.tail.finally(() => {
      this.closed = true;
      this.channel?.close();
      this.database.close();
    });
  }
}

/** The proxy delegates the full TaskRepository port to each committed snapshot. */
export type LocalTaskRepository = LocalCollectionOwner & TaskRepository;
export const LocalTaskRepository = LocalCollectionOwner as new (
  name?: string,
) => LocalTaskRepository;
