import {
  MdbaseError,
  type MdbaseClient,
  type Write,
  type wire,
} from "@mdbase-dev/sdk";
import { pendingRecoveryError } from "../cloud/outcome";
import { TASKNOTES_REQUEST_BUDGETS } from "../cloud/request-budgets";

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

export interface NativeRecordWriteState {
  readonly mutationId: string;
  readonly state:
    "pending" | "confirmed" | "rejected" | "unknown" | "conflicted";
  /** The receipt's reason for a rejection; never present otherwise. */
  readonly problem?: wire.Problem;
}
interface LocalMutation {
  readonly id: string;
  readonly key: string;
  readonly recordIds: Set<string>;
  read?: NativeMutation<unknown>["confirmed"];
  local?: NonNullable<NativeMutation<unknown>["local"]>;
  ack?: NativeMutation<unknown>["ack"];
  finished?: boolean;
  delivered?: boolean;
  state: NativeRecordWriteState["state"];
  receipt?: wire.Receipt;
  stopReceipt?: () => void;
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
  private readonly localWrites = new Map<string, LocalMutation>();
  private restoring: Promise<void> | null = null;

  /** Reuse a current-layer reader after local capture and again after ACK. */
  runRecord<Result>(
    operation: NativeMutation<Result>,
    owner: AbortSignal,
  ): Promise<Result> {
    return this.run({ ...operation, local: operation.confirmed }, owner);
  }

  /** Restore metadata from the native durable queue, never copy its documents. */
  restorePending(owner: AbortSignal): Promise<void> {
    if (this.restoring) return this.restoring;
    const run = (async () => {
      owner.throwIfAborted();
      const signal = AbortSignal.any([
        owner,
        AbortSignal.timeout(TASKNOTES_REQUEST_BUDGETS.foregroundMs),
      ]);
      const native = await this.client.pendingWrites(signal);
      signal.throwIfAborted();
      for (const pending of native.sort((a, b) => a.captured - b.captured)) {
        const receipt = pending.receipt;
        if (this.localWrites.has(receipt.mutation)) continue;
        const ids = new Set(
          pending.ops.flatMap((op) =>
            "id" in op && typeof op.id === "string" ? [op.id] : [],
          ),
        );
        if (!ids.size) continue; // Definitions/setup retain their separate authority path.
        const entry: LocalMutation = {
          id: receipt.mutation,
          key: `restored:${receipt.mutation}`,
          recordIds: ids,
          state: receipt.state,
          delivered: true,
          read: async (_receipt, signal) => this.readRestored([...ids], signal),
        };
        this.localWrites.set(entry.id, entry);
        this.publishReceipt(entry, receipt);
      }
      // Status/pending-count changes only trigger a real receipt read. They are
      // not proof of admission or of any record's current document.
      for (const entry of [...this.localWrites.values()]) {
        if (
          entry.finished ||
          entry.state === "rejected" ||
          entry.state === "conflicted"
        )
          continue;
        try {
          const receipt = await this.client.receipt(entry.id, signal);
          signal.throwIfAborted();
          this.finishLocal(entry, receipt, owner);
        } catch {
          if (signal.aborted) break;
          entry.state = "unknown";
          this.changed();
          this.scheduleReconcile(owner);
        }
      }
    })();
    this.restoring = run;
    void run
      .finally(() => {
        if (this.restoring === run) this.restoring = null;
      })
      .catch(() => {});
    return run;
  }

  constructor(
    private readonly client: MdbaseClient,
    private readonly changed: () => void = () => {},
    private readonly readRestored: (
      ids: readonly string[],
      signal: AbortSignal,
    ) => Promise<void> = async () => {},
    private readonly readDelivered?: (
      ids: readonly string[],
      signal: AbortSignal,
    ) => Promise<void>,
    private readonly reconcileWindowMs = NEXT_RECONCILE_FOREGROUND_MS,
  ) {}

  recordIds(mutationId: string): readonly string[] {
    return [...(this.localWrites.get(mutationId)?.recordIds ?? [])];
  }

  recordWriteState(recordId: string): NativeRecordWriteState | undefined {
    // Latest capture wins presentation. Older ACKs never relabel newer edits.
    let result: NativeRecordWriteState | undefined;
    for (const entry of this.localWrites.values())
      if (entry.recordIds.has(recordId))
        result =
          entry.state === "rejected" && entry.receipt?.problem
            ? {
                mutationId: entry.id,
                state: entry.state,
                problem: entry.receipt.problem,
              }
            : { mutationId: entry.id, state: entry.state };
    return result;
  }

  /** Forget rejected changes to a record once the person has chosen what to
   * keep. A rejection is proof of non-admission, so nothing is left to check. */
  dismissRejected(recordId: string): void {
    let changed = false;
    for (const [id, entry] of this.localWrites)
      if (entry.state === "rejected" && entry.recordIds.has(recordId)) {
        this.localWrites.delete(id);
        changed = true;
      }
    if (changed) this.changed();
  }

  /** A confirmed write supersedes older rejected writes to the same records,
   * so a retired confirmation never resurfaces an earlier rejection. */
  private retire(confirmed: LocalMutation): void {
    for (const [id, entry] of this.localWrites) {
      if (entry === confirmed) break;
      if (
        entry.state === "rejected" &&
        [...entry.recordIds].some((record) => confirmed.recordIds.has(record))
      )
        this.localWrites.delete(id);
    }
    this.localWrites.delete(confirmed.id);
  }

  private localQueue<Result>(run: () => Promise<Result>): Promise<Result> {
    const result = this.localTail.then(run);
    this.localTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private publishReceipt(entry: LocalMutation, receipt: wire.Receipt): void {
    if (receipt.mutation !== entry.id)
      throw new Error("Mdbase returned a receipt for a different mutation.");
    entry.receipt = receipt;
    entry.state =
      receipt.state === "confirmed" &&
      ((receipt.conflicts?.length ?? 0) > 0 ||
        (receipt.status !== undefined && receipt.status !== "applied"))
        ? "conflicted"
        : receipt.state;
    for (const record of receipt.records ?? []) entry.recordIds.add(record.id);
    this.changed();
  }

  private finishLocal(
    entry: LocalMutation,
    receipt: wire.Receipt,
    ownerSignal: AbortSignal,
  ): void {
    if (ownerSignal.aborted || entry.finished) return;
    try {
      this.publishReceipt(entry, receipt);
    } catch {
      entry.state = "unknown";
      this.changed();
      return;
    }
    if (receipt.state === "pending") return;
    entry.finished = receipt.state !== "unknown";
    entry.stopReceipt?.();
    entry.stopReceipt = undefined;
    if (receipt.state !== "confirmed" || entry.state === "conflicted") return;
    // Pushes contain receipt metadata, not an authority-qualified document.
    // Queue an actual current-layer read with captures, including newer edits.
    void this.localQueue(async () => {
      ownerSignal.throwIfAborted();
      const signal = AbortSignal.any([
        ownerSignal,
        AbortSignal.timeout(TASKNOTES_REQUEST_BUDGETS.foregroundMs),
      ]);
      if (!this.localWrites.has(entry.id)) return;
      if (entry.delivered && entry.ack) await entry.ack(receipt, signal);
      else if (entry.delivered && this.readDelivered)
        await this.readDelivered([...entry.recordIds], signal);
      else await entry.read?.(receipt, signal);
      signal.throwIfAborted();
      if (entry.delivered) this.retire(entry);
      this.changed();
    }).catch(() => {
      // Admission is known, but the result is not. Preserve exact recovery ID.
      if (!ownerSignal.aborted) {
        entry.state = "unknown";
        entry.finished = false;
        this.changed();
        this.scheduleReconcile(ownerSignal);
      }
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
      const previous = operation.requestId
        ? this.localWrites.get(operation.requestId)
        : [...this.localWrites.values()].find(
            (entry) =>
              entry.key === operation.key &&
              (entry.state === "unknown" ||
                (!entry.delivered && entry.state !== "rejected")),
          );
      if (
        previous &&
        previous.key !== operation.key &&
        previous.key !== `restored:${previous.id}`
      )
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
      const entry: LocalMutation = previous ?? {
        id,
        key: operation.key,
        recordIds: new Set(operation.recordIds?.()),
        read: operation.confirmed,
        local: operation.local!,
        ack: operation.ack,
        state: "unknown",
      };
      entry.local ??= operation.local;
      entry.read ??= operation.confirmed;
      this.localWrites.set(id, entry);
      // The heterogeneous ledger retains the original operation's reader.
      // Recovery must not substitute a newly supplied result callback.
      const complete = async (
        receipt: wire.Receipt,
        signal: AbortSignal,
      ): Promise<Result> => {
        if (receipt.state === "rejected")
          throw new RejectedNextMutation(id, receipt.problem);
        if (receipt.state !== "pending" && receipt.state !== "confirmed")
          throw new Error(`The native change remains ${receipt.state}.`);
        const local = entry.local as NonNullable<
          NativeMutation<Result>["local"]
        >;
        const value = await local(receipt, signal);
        signal.throwIfAborted();
        if (entry.receipt?.state === "rejected")
          throw new RejectedNextMutation(id, entry.receipt.problem);
        entry.delivered = true;
        if (receipt.state === "confirmed" && entry.state === "confirmed")
          this.retire(entry);
        signal.throwIfAborted();
        this.changed();
        return value;
      };
      try {
        let receipt: wire.Receipt;
        if (submit) {
          const write = await submit();
          receipt = write.receipt;
          this.publishReceipt(entry, receipt);
          if (receipt.state === "pending") {
            entry.stopReceipt = write.onReceipt((value) =>
              this.finishLocal(entry, value, ownerSignal),
            );
            ownerSignal.addEventListener("abort", () => entry.stopReceipt?.(), {
              once: true,
            });
            // Attach both branches immediately; background rejection is visible.
            void write.confirmed.then(
              (value) => this.finishLocal(entry, value, ownerSignal),
              () => this.finishLocal(entry, write.receipt, ownerSignal),
            );
          }
        } else {
          receipt = await this.client.receipt(id, signal);
          this.publishReceipt(entry, receipt);
        }
        return await complete(receipt, signal);
      } catch (reason) {
        if (reason instanceof RejectedNextMutation) throw reason;
        // A failed or cancelled result READ is not a failed write. Reconcile
        // the original MID by receipt until there is a definite answer; never
        // reissue its submission, and never hand that job to the user.
        const settled = transientReadFailure(reason)
          ? await this.reconcileLocal(entry, ownerSignal, complete)
          : null;
        if (settled) return settled.value;
        if (entry.receipt?.state === "rejected")
          throw new RejectedNextMutation(id, entry.receipt.problem);
        if (entry.state !== "conflicted") entry.state = "unknown";
        this.changed();
        // Keep reconciling in the background; the ledger settles on its own.
        this.scheduleReconcile(ownerSignal);
        throw pendingRecoveryError(id, reason);
      }
    });
  }

  /** Observe the original MID by receipt, with backoff, within a bounded
   * foreground window. Resolves with the result, or null when the window
   * closes without a definite answer. A rejection is definite and thrown. */
  private async reconcileLocal<Result>(
    entry: LocalMutation,
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
        const receipt = await this.client.receipt(entry.id, signal);
        signal.throwIfAborted();
        this.publishReceipt(entry, receipt);
        if (receipt.state === "rejected")
          throw new RejectedNextMutation(entry.id, receipt.problem);
        if (receipt.state !== "pending" && receipt.state !== "confirmed")
          continue;
        return { value: await complete(receipt, signal) };
      } catch (reason) {
        if (reason instanceof RejectedNextMutation) throw reason;
      }
    }
    return null;
  }

  private reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  private reconcileAttempts = 0;

  /** Background reconciliation of unconfirmed writes, with capped backoff,
   * until every write has a definite answer or the owner closes. */
  private scheduleReconcile(owner: AbortSignal): void {
    if (this.reconcileTimer || owner.aborted) return;
    const delay = Math.min(15_000, 500 * 2 ** this.reconcileAttempts++);
    const timer = setTimeout(() => {
      this.reconcileTimer = null;
      if (owner.aborted) return;
      void this.restorePending(owner)
        .catch(() => {})
        .finally(() => {
          if (
            [...this.localWrites.values()].some(
              (entry) => entry.state === "unknown" && !entry.finished,
            )
          )
            this.scheduleReconcile(owner);
          else this.reconcileAttempts = 0;
        });
    }, delay);
    this.reconcileTimer = timer;
    owner.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        if (this.reconcileTimer === timer) this.reconcileTimer = null;
      },
      { once: true },
    );
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
