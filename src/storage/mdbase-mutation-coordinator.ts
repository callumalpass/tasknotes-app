import {
  connectError,
  MdbaseConnectError,
  type JsonObject,
  type MdbaseConnection,
} from "@mdbase-dev/connect";

type MutationOperation<Result> = () => Promise<Result>;

interface PendingMutation {
  operation: MutationOperation<unknown>;
}

class MdbaseMutationCoordinator {
  private tail: Promise<void> = Promise.resolve();
  private pending: PendingMutation | null = null;

  run<Result>(operation: MutationOperation<Result>): Promise<Result> {
    const result = this.tail.then(
      () => this.execute(operation),
      () => this.execute(operation),
    );
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async execute<Result>(
    operation: MutationOperation<Result>,
  ): Promise<Result> {
    await this.recoverPending();
    try {
      return await operation();
    } catch (reason) {
      if (!isRetryableUnknownOutcome(reason)) throw reason;
      return this.retryUnknownOperation(operation);
    }
  }

  private async recoverPending(): Promise<void> {
    const pending = this.pending;
    if (!pending) return;
    try {
      await pending.operation();
      if (this.pending === pending) this.pending = null;
    } catch (reason) {
      if (!isRetryableUnknownOutcome(reason)) {
        if (this.pending === pending) this.pending = null;
        throw reason;
      }
      throw pendingRecoveryError(reason);
    }
  }

  private async retryUnknownOperation<Result>(
    operation: MutationOperation<Result>,
  ): Promise<Result> {
    try {
      return await operation();
    } catch (reason) {
      if (isRetryableUnknownOutcome(reason)) this.pending = { operation };
      throw reason;
    }
  }
}

const coordinators = new WeakMap<
  MdbaseConnection<JsonObject>,
  MdbaseMutationCoordinator
>();

export function runMdbaseMutation<Result>(
  connection: MdbaseConnection<JsonObject>,
  operation: MutationOperation<Result>,
): Promise<Result> {
  let coordinator = coordinators.get(connection);
  if (!coordinator) {
    coordinator = new MdbaseMutationCoordinator();
    coordinators.set(connection, coordinator);
  }
  return coordinator.run(operation);
}

function isRetryableUnknownOutcome(reason: unknown): boolean {
  return (
    reason instanceof MdbaseConnectError &&
    reason.outcomeUnknown &&
    reason.code !== "pending_mutation_unresolved"
  );
}

function pendingRecoveryError(reason: unknown): MdbaseConnectError {
  return connectError(
    "operation_outcome_unknown",
    "TaskNotes is still confirming an earlier change. This change was not sent. Keep the collection connected and retry.",
    { operationOutcome: "unknown", cause: reason },
  );
}
