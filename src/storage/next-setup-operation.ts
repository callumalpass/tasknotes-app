import {
  ModelSetupError,
  type ModelSetupProgressListener,
} from "../application/ports/model-setup";
import { TASKNOTES_REQUEST_BUDGETS } from "../cloud/request-budgets";

const pending = () =>
  new ModelSetupError({
    state: "outcome_unknown",
    message:
      "Checking whether setup finished. Its original changes are retained; no replacement mutation was submitted.",
  });

async function withinWindow(
  signal: AbortSignal,
  work: () => Promise<void>,
): Promise<void> {
  signal.throwIfAborted();
  let cancel!: () => void;
  const expired = new Promise<never>((_, reject) => {
    cancel = () => reject(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
  });
  try {
    // Do not let a delayed adapter reply make the operation unbounded.
    // Providers must still validate this same signal before durable completion.
    await Promise.race([work(), expired]);
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

/** Only an explicit setup action enters this bounded operation. Expiry is not
 * evidence of refusal/absence. Reconciliation can read the original receipt and
 * finish its exact readback, NEVER submit an attempted mutation again.
 * The original owner is pinned across BOTH windows; renewal cannot resurrect it.
 */
export async function atomicSetupOperation(
  owner: AbortSignal,
  work: (signal: AbortSignal) => Promise<void>,
  reconcile: (signal: AbortSignal) => Promise<void>,
  progress?: ModelSetupProgressListener,
): Promise<void> {
  owner.throwIfAborted();
  const deadline = AbortSignal.timeout(TASKNOTES_REQUEST_BUDGETS.atomicSetupMs);
  const signal = AbortSignal.any([owner, deadline]);
  progress?.("installing");
  try {
    await withinWindow(signal, () => work(signal));
    return;
  } catch (reason) {
    owner.throwIfAborted();
    if (!deadline.aborted) throw reason;
  }
  progress?.("checking_outcome");
  const reconciliationDeadline = AbortSignal.timeout(
    TASKNOTES_REQUEST_BUDGETS.setupReconciliationMs,
  );
  const reconciliation = AbortSignal.any([owner, reconciliationDeadline]);
  try {
    await withinWindow(reconciliation, () => reconcile(reconciliation));
  } catch (reason) {
    owner.throwIfAborted();
    if (reconciliationDeadline.aborted) throw pending();
    throw reason;
  }
}

export function setupStillPending(): never {
  throw pending();
}
