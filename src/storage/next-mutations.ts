import {
  MdbaseError,
  type MdbaseClient,
  type Write,
  type wire,
} from "@mdbase-dev/sdk";
import { pendingRecoveryError } from "../cloud/outcome";
import { TASKNOTES_REQUEST_BUDGETS } from "../cloud/request-budgets";

interface NativeMutation<Result> {
  /** Includes the logical action and its input, not generated timestamps. */
  key: string;
  /** Reads/validation happen before the submission boundary. */
  prepare(
    id: string,
    signal: AbortSignal,
  ): Promise<(() => Promise<Write>) | { value: Result }>;
  confirmed(receipt: wire.Receipt, signal: AbortSignal): Promise<Result>;
  /** Recovery only; never authorizes a replacement submission. */
  requestId?: string;
}

/** A rejected receipt is proof of non-admission, unlike a submit/read failure. */
export class RejectedNextMutation extends MdbaseError {
  constructor(
    readonly mutationId: string,
    problem?: wire.Problem,
  ) {
    super(
      problem ?? {
        code: "internal",
        recovery: "contact_support",
        message: "Mdbase rejected the change without a problem.",
      },
    );
  }
}

/** One serialized native mutation stream per collection instance. Unknown writes
 * retain their exact identity; recovery observes receipts, never reissues an op.
 */
export class NextMutations {
  private tail: Promise<void> = Promise.resolve();
  private pending: {
    key: string;
    id: string;
    receipt?: wire.Receipt;
    confirmed(receipt: wire.Receipt, signal: AbortSignal): Promise<unknown>;
  } | null = null;

  constructor(private readonly client: MdbaseClient) {}

  run<Result>(
    operation: NativeMutation<Result>,
    ownerSignal: AbortSignal,
  ): Promise<Result> {
    const result = this.tail.then(async () => {
      ownerSignal.throwIfAborted();
      const signal = AbortSignal.any([
        ownerSignal,
        AbortSignal.timeout(TASKNOTES_REQUEST_BUDGETS.foregroundMs),
      ]);
      if (
        this.pending &&
        (this.pending.key !== operation.key ||
          (operation.requestId && operation.requestId !== this.pending.id))
      )
        throw new MdbaseError({
          code: "conflict",
          recovery: "resolve_outcome",
          reason: "earlier_mutation_pending",
          message:
            "Review the earlier native change before making another change.",
          // This action was never submitted. Do not label it uncertain or give
          // its caller the earlier action's request identity to adopt.
          details: this.pending.id,
        });
      const recovering = Boolean(this.pending || operation.requestId);
      const pending = this.pending ?? {
        key: operation.key,
        id: operation.requestId ?? crypto.randomUUID(),
        confirmed: operation.confirmed,
      };
      // A rejected template/read/model validation is not an uncertain write.
      const submit = recovering
        ? null
        : await operation.prepare(pending.id, signal);
      signal.throwIfAborted();
      if (submit && typeof submit !== "function") return submit.value;
      this.pending = pending;
      let receipt: wire.Receipt;
      try {
        receipt =
          pending.receipt ??
          (recovering
            ? await this.client.receipt(pending.id, signal)
            : (await submit!()).receipt);
        if (receipt.mutation !== pending.id)
          throw new Error(
            "Mdbase returned a receipt for a different mutation.",
          );
        if (receipt.state === "pending")
          receipt = await this.client.awaitReceipt(
            pending.id,
            TASKNOTES_REQUEST_BUDGETS.foregroundMs,
            signal,
          );
      } catch (reason) {
        // An exception after submit/reconnect is not proof of non-admission.
        throw pendingRecoveryError(pending.id, reason);
      }
      if (receipt.mutation !== pending.id)
        throw pendingRecoveryError(
          pending.id,
          new Error("Mdbase returned a receipt for a different mutation."),
        );
      if (receipt.state === "rejected") {
        this.pending = null;
        throw new RejectedNextMutation(pending.id, receipt.problem);
      }
      if (receipt.state !== "confirmed")
        throw pendingRecoveryError(
          pending.id,
          new Error(`The native change remains ${receipt.state}.`),
        );
      pending.receipt = receipt;
      // If a confirmed write's result cannot be read, retain its receipt and
      // repeat only that read on retry, not the accepted mutation.
      // Retain the original result reader and native target, rather than
      // resolving a portable ID against a newer cache after an uncertain write.
      let value: unknown;
      try {
        value = await pending.confirmed(receipt, signal);
        signal.throwIfAborted();
      } catch (reason) {
        // Result processing is past admission too. Keep the caller's recovery
        // identity even for a missing record or cancellation after confirmation.
        throw pendingRecoveryError(pending.id, reason);
      }
      this.pending = null;
      return value as Result;
    });
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
