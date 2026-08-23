import {
  type ConnectRequestOptions,
  type JsonObject,
  type MdbaseConnection,
} from "@mdbase-dev/connect";
import {
  connectProblemFromError,
  noPendingMutationError,
  pendingRecoveryError,
  requireConnectOutcome,
} from "../cloud/outcome";

type MutationOperation<Result> = () => Promise<Result>;

export interface MdbaseMutationOptions<Result, Recovered> {
  /** Stable application intent identity, distinct from the SDK request ID. */
  key: string;
  /** Reapply repository-side cache effects after an authority receipt recovers. */
  mapRecovered(value: Recovered): Result;
  /** Persisted SDK request identity associated with a durable app command. */
  requestId?: string;
  request?: ConnectRequestOptions;
}

interface PendingMutation {
  key: string;
  requestId: string;
  mapRecovered(value: unknown): unknown;
}

interface RecoveredMatch<Result> {
  matched: true;
  value: Result;
}

interface NoRecoveredMatch {
  matched: false;
}

class MdbaseMutationCoordinator {
  private tail: Promise<void> = Promise.resolve();
  private readonly pending = new Map<string, PendingMutation>();

  constructor(private readonly connection: MdbaseConnection<JsonObject>) {}

  run<Result, Recovered>(
    operation: MutationOperation<Result>,
    options: MdbaseMutationOptions<Result, Recovered>,
  ): Promise<Result> {
    const result = this.tail.then(
      () => this.execute(operation, options),
      () => this.execute(operation, options),
    );
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  reconcile(options: ConnectRequestOptions = {}): Promise<void> {
    const result = this.tail.then(
      () =>
        this.recoverOutstanding(undefined, options, true).then(() => undefined),
      () =>
        this.recoverOutstanding(undefined, options, true).then(() => undefined),
    );
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async execute<Result, Recovered>(
    operation: MutationOperation<Result>,
    options: MdbaseMutationOptions<Result, Recovered>,
  ): Promise<Result> {
    const recovered = await this.recoverOutstanding(options, options.request);
    if (recovered.matched) return recovered.value;
    try {
      return await operation();
    } catch (reason) {
      const requestId = unknownOutcomeRequestId(reason);
      if (!requestId) throw reason;
      const pending: PendingMutation = {
        key: options.key,
        requestId,
        mapRecovered: (value) => options.mapRecovered(value as Recovered),
      };
      this.pending.set(requestId, pending);
      return (await this.recoverOne(pending, options.request)) as Result;
    }
  }

  private async recoverOutstanding<Result, Recovered>(
    current?: MdbaseMutationOptions<Result, Recovered>,
    request: ConnectRequestOptions = {},
    recoverUntracked = false,
  ): Promise<RecoveredMatch<Result> | NoRecoveredMatch> {
    const requested = current?.requestId;
    if (current && requested !== undefined) {
      const handle = this.connection.pendingMutation<Recovered>(requested);
      if (handle) {
        const value = requireConnectOutcome(await handle.recover(request));
        this.pending.delete(requested);
        return { matched: true, value: current.mapRecovered(value) };
      }
      throw noPendingMutationError();
    }

    for (const handle of this.connection.pendingMutations<unknown>()) {
      if (handle.requestId === requested) continue;
      const pending = this.pending.get(handle.requestId);
      if (pending && current && pending.key === current.key) {
        const value = await this.recoverOne(pending, request);
        return { matched: true, value: value as Result };
      }
      if (!pending && !recoverUntracked) continue;
      try {
        const value = requireConnectOutcome(await handle.recover(request));
        this.pending.delete(handle.requestId);
        pending?.mapRecovered(value);
      } catch (reason) {
        if (unknownOutcomeRequestId(reason))
          throw pendingRecoveryError(handle.requestId, reason);
        this.pending.delete(handle.requestId);
        throw reason;
      }
    }
    return { matched: false };
  }

  private async recoverOne(
    pending: PendingMutation,
    request: ConnectRequestOptions = {},
  ): Promise<unknown> {
    const handle = this.connection.pendingMutation<unknown>(pending.requestId);
    if (!handle) {
      this.pending.delete(pending.requestId);
      throw noPendingMutationError();
    }
    try {
      const value = requireConnectOutcome(await handle.recover(request));
      this.pending.delete(pending.requestId);
      return pending.mapRecovered(value);
    } catch (reason) {
      if (unknownOutcomeRequestId(reason)) throw reason;
      this.pending.delete(pending.requestId);
      throw reason;
    }
  }
}

const coordinators = new WeakMap<
  MdbaseConnection<JsonObject>,
  MdbaseMutationCoordinator
>();

export function runMdbaseMutation<Result, Recovered>(
  connection: MdbaseConnection<JsonObject>,
  operation: MutationOperation<Result>,
  options: MdbaseMutationOptions<Result, Recovered>,
): Promise<Result> {
  return coordinatorFor(connection).run(operation, options);
}

/** Recover durable SDK receipts before reading canonical collection state. */
export function reconcileMdbaseMutations(
  connection: MdbaseConnection<JsonObject>,
  options: ConnectRequestOptions = {},
): Promise<void> {
  return coordinatorFor(connection).reconcile(options);
}

export function mdbaseMutationKey(operation: string, input: unknown): string {
  return `${operation}:${JSON.stringify(input)}`;
}

export function unknownOutcomeRequestId(reason: unknown): string | null {
  const problem = connectProblemFromError(reason);
  if (!problem || problem.operation_outcome !== "unknown") return null;
  const details = problem.details;
  if (
    !details ||
    typeof details !== "object" ||
    !("request_id" in details) ||
    typeof details.request_id !== "string" ||
    !details.request_id
  )
    return null;
  return details.request_id;
}

function coordinatorFor(
  connection: MdbaseConnection<JsonObject>,
): MdbaseMutationCoordinator {
  let coordinator = coordinators.get(connection);
  if (!coordinator) {
    coordinator = new MdbaseMutationCoordinator(connection);
    coordinators.set(connection, coordinator);
  }
  return coordinator;
}
