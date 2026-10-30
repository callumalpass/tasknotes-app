import {
  MdbaseError,
  type MdbaseClient,
  type Write,
  type wire,
} from "@mdbase-dev/sdk";
import { TASKNOTES_REQUEST_BUDGETS } from "../cloud/request-budgets";

/** Preserve the exact request for delayed-deletion journals and explicit review. */
function pendingRecoveryError(requestId: string, cause: unknown): MdbaseError {
  return new MdbaseError(
    {
      code: "outcome_unknown",
      recovery: "resolve_outcome",
      message:
        "The change may have been applied; its result is not confirmed yet. TaskNotes keeps checking its exact result automatically.",
    },
    { mutationId: requestId, cause },
  );
}

/** How long a foreground write keeps reconciling its own result before it
 * hands the write to background reconciliation. */
const NEXT_RECONCILE_FOREGROUND_MS = 8_000;

/** A cancelled, interrupted or temporarily unavailable READ says nothing
 * about the write; a deterministic READ refusal is not retried inline. */
function transientReadFailure(reason: unknown): boolean {
  if (reason instanceof MdbaseError)
    return (
      reason.code === "cancelled" ||
      reason.code === "unavailable" ||
      reason.code === "rate_limited" ||
      reason.code === "outcome_unknown"
    );
  return (
    reason instanceof DOMException &&
    (reason.name === "AbortError" || reason.name === "TimeoutError")
  );
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

interface NativeMutation<Result> {
  /** Includes the logical action and its input, not generated timestamps. */
  key: string;
  /** Reads/validation happen before the submission boundary. */
  prepare(
    id: string,
    signal: AbortSignal,
  ): Promise<(() => Promise<Write>) | { value: Result }>;
  confirmed(receipt: wire.Receipt, signal: AbortSignal): Promise<Result>;
  /** Opt-in genuine native local result, never an application projection. */
  local?(receipt: wire.Receipt, signal: AbortSignal): Promise<Result>;
  /** Delivered records may later be edited/deleted; ACK reads current metadata. */
  ack?(receipt: wire.Receipt, signal: AbortSignal): Promise<void>;
  /** Native record IDs retained by preparation, including deletes. */
  recordIds?(): readonly string[];
  /** Recovery only; never authorizes a replacement submission. */
  requestId?: string;
}

/** The original identity and readers of a captured write until the app has
 * shown its result, so a retry of the same action observes it instead of
 * submitting again. Save state is the SDK ledger's, not this. */
interface RetainedWrite {
  readonly id: string;
  readonly key: string;
  readonly recordIds: Set<string>;
  readonly local: NonNullable<NativeMutation<unknown>["local"]>;
  readonly ack?: NativeMutation<unknown>["ack"];
  delivered: boolean;
  /** The result READ failed: the next attempt observes this ID. */
  unknown: boolean;
  receipt?: wire.Receipt;
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

/** Confirmed-only definitions retain their original stream. Opt-in record writes
 * serialize preparation/capture/current reads, never server ACK waits. Unknown
 * writes retain exact identities; recovery reads receipts, never reissues ops.
 * Save state (pending, refused, kept on this device) is the SDK's write ledger.
 */
export class NextMutations {
  private tail: Promise<void> = Promise.resolve();
  private pending: {
    key: string;
    id: string;
    receipt?: wire.Receipt;
    confirmed(receipt: wire.Receipt, signal: AbortSignal): Promise<unknown>;
  } | null = null;

  private localTail: Promise<void> = Promise.resolve();
  private readonly retained = new Map<string, RetainedWrite>();

  constructor(
    private readonly client: MdbaseClient,
    /** Re-read records once a locally captured write is confirmed. */
    private readonly readDelivered: (
      ids: readonly string[],
      signal: AbortSignal,
    ) => Promise<void> = async () => {},
    private readonly reconcileWindowMs = NEXT_RECONCILE_FOREGROUND_MS,
  ) {}

  /** Reuse a current-layer reader after local capture and again after ACK. */
  runRecord<Result>(
    operation: NativeMutation<Result>,
    owner: AbortSignal,
  ): Promise<Result> {
    return this.run({ ...operation, local: operation.confirmed }, owner);
  }

  private localQueue<Result>(run: () => Promise<Result>): Promise<Result> {
    const result = this.localTail.then(run);
    this.localTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** A captured write was confirmed: pushes carry receipt metadata, not an
   * authority-qualified document, so read the records again behind captures. */
  /** A newer write to a record answers its earlier refusals. */
  private supersedeRefusals(recordIds: ReadonlySet<string>, id: string): void {
    const ledger = this.client.ledger;
    for (const entry of ledger.getSnapshot().rejected)
      if (
        entry.mutationId !== id &&
        entry.records.some((record) => recordIds.has(record))
      )
        void ledger.acknowledge(entry.mutationId).catch(() => {});
  }

  private confirmedLater(
    entry: RetainedWrite,
    receipt: wire.Receipt,
    owner: AbortSignal,
  ): void {
    void this.localQueue(async () => {
      owner.throwIfAborted();
      const signal = AbortSignal.any([
        owner,
        AbortSignal.timeout(TASKNOTES_REQUEST_BUDGETS.foregroundMs),
      ]);
      if (entry.delivered && entry.ack) await entry.ack(receipt, signal);
      else await this.readDelivered([...entry.recordIds], signal);
      signal.throwIfAborted();
      if (entry.delivered) this.retained.delete(entry.id);
    }).catch(() => {
      // The ledger holds the save state; the next change event re-reads.
    });
  }

  private runLocal<Result>(
    operation: NativeMutation<Result>,
    ownerSignal: AbortSignal,
  ): Promise<Result> {
    return this.localQueue(async () => {
      ownerSignal.throwIfAborted();
      const signal = AbortSignal.any([
        ownerSignal,
        AbortSignal.timeout(TASKNOTES_REQUEST_BUDGETS.foregroundMs),
      ]);
      // A retry of the same action observes the original write.
      const previous = operation.requestId
        ? this.retained.get(operation.requestId)
        : [...this.retained.values()].find(
            (entry) =>
              entry.key === operation.key &&
              (entry.unknown || !entry.delivered),
          );
      if (previous && previous.key !== operation.key)
        throw new MdbaseError({
          code: "conflict",
          recovery: "resolve_outcome",
          reason: "original_mutation_mismatch",
          message:
            "This request belongs to a different original change. Check its save without replacing the request.",
        });
      const id = previous?.id ?? operation.requestId ?? crypto.randomUUID();
      // A retained identity can only be observed, never submitted again.
      const submit =
        previous || operation.requestId
          ? null
          : await operation.prepare(id, signal);
      signal.throwIfAborted();
      if (submit && typeof submit !== "function") return submit.value;
      // Recovery keeps the original operation's reader, never a new callback.
      const entry: RetainedWrite = previous ?? {
        id,
        key: operation.key,
        recordIds: new Set(operation.recordIds?.()),
        local: operation.local!,
        ack: operation.ack,
        delivered: false,
        unknown: false,
      };
      this.retained.set(id, entry);
      const observe = (receipt: wire.Receipt) => {
        if (receipt.mutation !== id)
          throw new Error(
            "Mdbase returned a receipt for a different mutation.",
          );
        entry.receipt = receipt;
        for (const record of receipt.records ?? [])
          entry.recordIds.add(record.id);
        return receipt;
      };
      const rejected = (problem?: wire.Problem) => {
        this.retained.delete(id);
        return new RejectedNextMutation(id, problem);
      };
      const complete = async (
        receipt: wire.Receipt,
        signal: AbortSignal,
      ): Promise<Result> => {
        if (receipt.state === "rejected") throw rejected(receipt.problem);
        if (receipt.state !== "pending" && receipt.state !== "confirmed")
          throw new Error(`The native change remains ${receipt.state}.`);
        const value = (await entry.local(receipt, signal)) as Result;
        signal.throwIfAborted();
        if (entry.receipt?.state === "rejected")
          throw rejected(entry.receipt.problem);
        entry.delivered = true;
        entry.unknown = false;
        if (entry.receipt?.state === "confirmed") this.retained.delete(id);
        return value;
      };
      try {
        let receipt: wire.Receipt;
        if (submit) {
          const write = await submit();
          receipt = observe(write.receipt);
          this.supersedeRefusals(entry.recordIds, id);
          if (receipt.state === "pending")
            // Attach both branches immediately; background rejection is visible.
            void write.confirmed.then(
              (confirmed) => {
                observe(confirmed);
                this.confirmedLater(entry, confirmed, ownerSignal);
              },
              () => {
                observe(write.receipt);
                if (entry.delivered) this.retained.delete(id);
              },
            );
        } else {
          receipt = observe(await this.client.receipt(id, signal));
        }
        return await complete(receipt, signal);
      } catch (reason) {
        if (reason instanceof RejectedNextMutation) throw reason;
        // A failed or cancelled result READ is not a failed write: the write is
        // on this device and in the SDK ledger. Observe the original MID until
        // there is a result to show; never reissue its submission.
        const settled = transientReadFailure(reason)
          ? await this.reconcileLocal(id, ownerSignal, complete)
          : null;
        if (settled) return settled.value;
        if (entry.receipt?.state === "rejected")
          throw rejected(entry.receipt.problem);
        entry.unknown = true;
        throw pendingRecoveryError(id, reason);
      }
    });
  }

  /** Observe the original MID by receipt, with backoff, within a bounded
   * foreground window. Resolves with the result, or null when the window
   * closes without a definite answer. A rejection is definite and thrown. */
  private async reconcileLocal<Result>(
    id: string,
    ownerSignal: AbortSignal,
    complete: (receipt: wire.Receipt, signal: AbortSignal) => Promise<Result>,
  ): Promise<{ value: Result } | null> {
    if (ownerSignal.aborted) return null;
    const signal = AbortSignal.any([
      ownerSignal,
      AbortSignal.timeout(this.reconcileWindowMs),
    ]);
    for (let attempt = 0; !signal.aborted; attempt++) {
      if (attempt)
        await abortableDelay(Math.min(2_000, 100 * 2 ** attempt), signal);
      if (signal.aborted) break;
      try {
        const receipt = await this.client.receipt(id, signal);
        signal.throwIfAborted();
        if (receipt.state === "rejected")
          throw new RejectedNextMutation(id, receipt.problem);
        if (receipt.state !== "pending" && receipt.state !== "confirmed")
          continue;
        return { value: await complete(receipt, signal) };
      } catch (reason) {
        if (reason instanceof RejectedNextMutation) throw reason;
      }
    }
    return null;
  }

  run<Result>(
    operation: NativeMutation<Result>,
    ownerSignal: AbortSignal,
  ): Promise<Result> {
    if (operation.local) return this.runLocal(operation, ownerSignal);
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
