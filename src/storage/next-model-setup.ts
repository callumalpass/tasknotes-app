import { MdbaseError, type MdbaseClient, type wire } from "@mdbase-dev/sdk";
import {
  ModelSetupError,
  TaskNotesModelRequiredError,
  type ModelDefinitionOps,
  type ModelSetupIntent,
  type ModelSetupJournal,
  type ModelSetupScope,
  type ModelSetupView,
  type TaskNotesModelSetup,
} from "../application/ports/model-setup";
import { TASKNOTES_REQUEST_BUDGETS } from "../cloud/request-budgets";
import { nativeModelDefinitionPlan } from "./next-model-plan";
import { nextTaskProviders } from "./next-task-catalog";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const nil = "00000000-0000-0000-0000-000000000000";
function sameScope(a: ModelSetupScope, b: ModelSetupScope) {
  return (
    a.account === b.account &&
    a.installation === b.installation &&
    a.collection === b.collection
  );
}
function blocked(message: string): ModelSetupError {
  return new ModelSetupError({ state: "blocked", message });
}
function uncertain(): ModelSetupError {
  return new ModelSetupError({
    state: "outcome_unknown",
    message:
      "Preserve this collection and resume its original TaskNotes setup. Verification or completion recording is not yet finished.",
  });
}
function sameOps(a: ModelDefinitionOps, b: ModelDefinitionOps) {
  return a.every(
    (op, index) => op.path === b[index].path && op.doc === b[index].doc,
  );
}
async function withSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([promise, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** Definition installation on one original client and controller-bound journal.
 * Application resumption reconciles by receipt/readback only; it does not issue
 * another submit call. SDK transport retries retain the same mutation ID.
 */
export class NativeModelSetup implements TaskNotesModelSetup {
  private readonly scope: ModelSetupScope;
  private tail: Promise<void> = Promise.resolve();
  constructor(
    private readonly client: MdbaseClient,
    private readonly journal: ModelSetupJournal,
    private readonly ownerSignal: () => AbortSignal,
    private readonly verified: () => Promise<void>,
  ) {
    this.scope = Object.freeze({ ...journal.scope });
  }

  private signal(): AbortSignal {
    const signal = this.ownerSignal();
    signal.throwIfAborted();
    if (
      !sameScope(this.scope, this.journal.scope) ||
      this.client.hello.collection !== this.scope.collection ||
      !uuid.test(this.scope.collection) ||
      Object.values(this.scope).some(
        (id) => typeof id !== "string" || !id || id === nil,
      )
    )
      throw blocked(
        "The original model setup collection binding is unavailable.",
      );
    return signal;
  }

  private intent(value: ModelSetupIntent): ModelSetupIntent {
    if (
      !value ||
      value.version !== 1 ||
      !sameScope(value.scope, this.scope) ||
      !uuid.test(value.mutationId) ||
      value.mutationId === nil ||
      !["prepared", "attempted", "confirmed", "verified"].includes(
        value.phase,
      ) ||
      !Array.isArray(value.ops) ||
      value.ops.length !== 2 ||
      value.ops.some(
        (op) =>
          !op ||
          op.kind !== "resource_put" ||
          op.mustNotExist !== true ||
          typeof op.path !== "string" ||
          typeof op.doc !== "string" ||
          !op.doc ||
          Object.keys(op).sort().join() !== "doc,kind,mustNotExist,path",
      ) ||
      !value.ops[0].path.endsWith("/tasknotes.task.md") ||
      !value.ops[1].path.endsWith("/task.md") ||
      value.ops[0].path === value.ops[1].path
    )
      throw blocked(
        "Preserve the original model setup intent; its binding is invalid.",
      );
    const copy = structuredClone(value);
    Object.freeze(copy.scope);
    copy.ops.forEach(Object.freeze);
    Object.freeze(copy.ops);
    return Object.freeze(copy);
  }

  private async modelPresent(signal: AbortSignal): Promise<boolean> {
    try {
      await nextTaskProviders(this.client, signal);
      signal.throwIfAborted();
      return true;
    } catch (reason) {
      if (reason instanceof TaskNotesModelRequiredError) return false;
      throw reason;
    }
  }

  private requirePermission() {
    // This public grant is necessary, not sufficient: the actual native write
    // still enforces permission. Neither a role nor READ readiness enables it.
    if (!this.client.hello.grant.capabilities.includes("definitions.manage"))
      throw new ModelSetupError({
        state: "permission_required",
        message:
          "Approve permission to install TaskNotes definitions before setting up this collection.",
      });
  }

  private async freshPlan(signal: AbortSignal): Promise<ModelDefinitionOps> {
    this.requirePermission();
    const catalog = await this.client.describe(signal);
    signal.throwIfAborted();
    const ops = nativeModelDefinitionPlan(catalog.settings);
    const resources = await this.client.resources.list({ text: true, signal });
    signal.throwIfAborted();
    if (!resources.complete)
      throw blocked("Mdbase has not supplied the complete definition list.");
    if (
      resources.resources.some((resource) =>
        ops.some((op) => op.path === resource.path),
      )
    )
      throw blocked(
        "A TaskNotes definition path is already occupied. Existing definitions will not be overwritten.",
      );
    return ops;
  }

  async inspect(): Promise<ModelSetupView> {
    const signal = this.signal();
    try {
      const stored = await this.journal.load(signal);
      signal.throwIfAborted();
      if (stored) {
        const intent = this.intent(stored);
        if (intent.phase !== "verified") return uncertain().view;
        if (!(await this.modelPresent(signal)))
          throw blocked(
            "The original setup was verified, but the collection's current TaskNotes model is unavailable.",
          );
        return { state: "ready" };
      }
      if (await this.modelPresent(signal)) return { state: "ready" };
      await this.freshPlan(signal);
      return { state: "required" };
    } catch (reason) {
      signal.throwIfAborted();
      if (reason instanceof ModelSetupError) return reason.view;
      if (reason instanceof MdbaseError && reason.code === "forbidden")
        return {
          state: "permission_required",
          message:
            "Approve access to the original collection's TaskNotes definitions.",
        };
      return {
        state: "blocked",
        message:
          reason instanceof Error
            ? reason.message
            : "Original model setup is unavailable.",
      };
    }
  }

  private exclusive(operation: () => Promise<void>): Promise<void> {
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  install(): Promise<void> {
    return this.exclusive(async () => {
      const signal = this.signal();
      const stored = await this.journal.load(signal);
      signal.throwIfAborted();
      if (stored) {
        const intent = this.intent(stored);
        if (intent.phase === "verified") {
          await this.execute(intent, signal);
          return;
        }
        throw uncertain();
      }
      if (await this.modelPresent(signal)) {
        await this.finish(signal);
        return;
      }
      const ops = await this.freshPlan(signal);
      let intent = this.intent(await this.journal.prepare(ops, signal));
      signal.throwIfAborted();
      if (intent.phase !== "prepared" || !sameOps(intent.ops, ops))
        throw uncertain();
      intent = await this.execute(intent, signal);
      if (intent.phase !== "verified") throw uncertain();
    });
  }
  resume(): Promise<void> {
    return this.exclusive(async () => {
      const signal = this.signal();
      const stored = await this.journal.load(signal);
      signal.throwIfAborted();
      if (!stored) {
        // An already-valid model can need only the original creator's
        // completion recording. No model intent or mutation is invented.
        if (await this.modelPresent(signal)) {
          await this.finish(signal);
          return;
        }
        throw blocked(
          "No original TaskNotes setup intent is available to resume.",
        );
      }
      const intent = this.intent(stored);
      await this.execute(intent, signal);
    });
  }

  private async finish(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    try {
      await this.verified();
      signal.throwIfAborted();
    } catch {
      throw uncertain();
    }
  }

  private transition(
    before: ModelSetupIntent,
    after: ModelSetupIntent,
    phase: ModelSetupIntent["phase"],
  ) {
    const intent = this.intent(after);
    if (
      intent.mutationId !== before.mutationId ||
      !sameOps(intent.ops, before.ops) ||
      intent.phase !== phase
    )
      throw blocked("The original model setup intent changed during recovery.");
    return intent;
  }

  private async execute(
    original: ModelSetupIntent,
    signal: AbortSignal,
  ): Promise<ModelSetupIntent> {
    let intent = original;
    let receipt: wire.Receipt;
    if (intent.phase === "prepared") {
      const plan = await this.freshPlan(signal);
      if (!sameOps(plan, intent.ops))
        throw blocked(
          "The original definition plan no longer matches this collection. Preserve it for recovery.",
        );
      intent = this.transition(
        intent,
        await this.journal.recordAttempt(intent.mutationId, signal),
        "attempted",
      );
      signal.throwIfAborted();
      try {
        const writes = await this.client.submit([...intent.ops], {
          mutationId: intent.mutationId,
          signal,
        });
        if (
          writes.length !== 1 ||
          writes[0]!.receipt.mutation !== intent.mutationId
        )
          throw uncertain();
        receipt = await withSignal(writes[0]!.confirmed, signal);
      } catch {
        throw uncertain();
      }
    } else {
      try {
        receipt = await this.client.awaitReceipt(
          intent.mutationId,
          TASKNOTES_REQUEST_BUDGETS.foregroundMs,
          signal,
        );
      } catch {
        throw uncertain();
      }
    }
    signal.throwIfAborted();
    if (receipt.mutation !== intent.mutationId) throw uncertain();
    if (receipt.state === "rejected")
      throw blocked(
        "Mdbase did not accept the original TaskNotes setup. Its identity is retained; no replacement will be submitted.",
      );
    if (receipt.state !== "confirmed") throw uncertain();
    try {
      if (intent.phase === "attempted")
        intent = this.transition(
          intent,
          await this.journal.recordConfirmed(intent.mutationId, signal),
          "confirmed",
        );
      const listed = await this.client.resources.list({ text: true, signal });
      if (!listed.complete) throw uncertain();
      for (const op of intent.ops) {
        const matches = listed.resources.filter(
          (resource) => resource.path === op.path,
        );
        if (
          matches.length !== 1 ||
          matches[0]!.state !== "confirmed" ||
          matches[0]!.text !== op.doc
        )
          throw uncertain();
        const resource = await this.client.resources.get(op.path, signal);
        if (
          resource.path !== op.path ||
          resource.state !== "confirmed" ||
          resource.text !== op.doc ||
          resource.revision !== matches[0]!.revision
        )
          throw uncertain();
      }
      if (!(await this.modelPresent(signal))) throw uncertain();
      signal.throwIfAborted();
      intent = this.transition(
        intent,
        await this.journal.recordVerified(intent.mutationId, signal),
        "verified",
      );
      signal.throwIfAborted();
      await this.finish(signal);
      return intent;
    } catch {
      throw uncertain();
    }
  }
}
