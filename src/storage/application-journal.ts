import Dexie, { type EntityTable } from "dexie";

import type {
  DurableTaskCommand,
  MutationJournal,
} from "../application/mutation-journal";

class TaskCommandDatabase extends Dexie {
  commands!: EntityTable<DurableTaskCommand, "operationId">;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      commands: "&operationId,collectionId,kind,requestedAt,commitAfter",
    });
  }
}

export class IndexedDbMutationJournal implements MutationJournal {
  private readonly database: TaskCommandDatabase;

  constructor(name = "tasknotes-commands-v2") {
    this.database = new TaskCommandDatabase(name);
  }

  private async ensureOpen(): Promise<void> {
    if (!this.database.isOpen()) await this.database.open();
  }

  async list(collectionId: string): Promise<DurableTaskCommand[]> {
    await this.ensureOpen();
    return this.database.commands.where({ collectionId }).sortBy("requestedAt");
  }

  async put(command: DurableTaskCommand): Promise<void> {
    await this.ensureOpen();
    await this.database.commands.put(structuredClone(command));
  }

  async remove(operationId: string): Promise<void> {
    await this.ensureOpen();
    await this.database.commands.delete(operationId);
  }

  close(): void {
    this.database.close();
  }
}
