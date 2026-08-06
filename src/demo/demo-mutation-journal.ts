import type {
  DurableTaskCommand,
  MutationJournal,
} from "../application/mutation-journal";

/** Session-only application intent for the disposable demo collection. */
export class DemoMutationJournal implements MutationJournal {
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
}
