import type {
  DurableTaskCommand,
  MutationJournal,
} from "../application/mutation-journal";

/** Deterministic journal for component and application contract tests. */
export class MemoryMutationJournal implements MutationJournal {
  private commands: DurableTaskCommand[] = [];

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

  snapshot(): DurableTaskCommand[] {
    return structuredClone(this.commands);
  }
}
