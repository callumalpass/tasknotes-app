import { MdbaseError, type MdbaseClient, type wire } from "@mdbase-dev/sdk";
import { MdbaseError as CoreError, type Resources } from "mdbase";
import {
  MODEL_SETUP_LIMITS,
  ModelSetupError,
  TaskNotesModelRequiredError,
  type ModelPackPlan,
  type ModelPackSetupIntent,
  type ModelSetupIntent,
  type ModelSetupJournal,
  type ModelSetupScope,
  type ModelSetupView,
  type TaskNotesModelSetup,
} from "../application/ports/model-setup";
import { TASKNOTES_REQUEST_BUDGETS } from "../cloud/request-budgets";
import {
  nativeModelPackAssessment,
  nativeModelPackPlan,
  TASKNOTES_MODEL_PACK,
} from "./next-model-plan";
import { nextTaskProviders } from "./next-task-catalog";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const hash = /^sha256:[0-9a-f]{64}$/;
const nil = "00000000-0000-0000-0000-000000000000";
function sameScope(a: ModelSetupScope, b: ModelSetupScope) {
  return (
    a.account === b.account &&
    a.installation === b.installation &&
    a.collection === b.collection
  );
}
function keys(value: object, expected: string) {
  return Object.keys(value).sort().join() === expected;
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
function isHash(value: unknown): value is string {
  return typeof value === "string" && hash.test(value);
}
function path(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MODEL_SETUP_LIMITS.pathCodeUnits
  );
}
function validPlan(plan: ModelPackPlan): boolean {
  if (
    !plan ||
    !keys(plan, "assessmentDigest,ops,pack,readback") ||
    !plan.pack ||
    !keys(plan.pack, "digest,id,version") ||
    plan.pack.id !== TASKNOTES_MODEL_PACK.id ||
    plan.pack.version !== TASKNOTES_MODEL_PACK.version ||
    !isHash(plan.pack.digest) ||
    !isHash(plan.assessmentDigest) ||
    !Array.isArray(plan.ops) ||
    plan.ops.length > MODEL_SETUP_LIMITS.operations ||
    !Array.isArray(plan.readback) ||
    !plan.readback.length ||
    plan.readback.length > MODEL_SETUP_LIMITS.readbacks
  )
    return false;
  if (
    plan.ops.some((op) => {
      if (!op || !path(op.path)) return true;
      if (op.kind === "resource_put")
        return (
          typeof op.doc !== "string" ||
          typeof op.mustNotExist !== "boolean" ||
          (op.mustNotExist
            ? op.baseRevision !== undefined
            : !isHash(op.baseRevision)) ||
          !keys(
            op,
            op.baseRevision === undefined
              ? "doc,kind,mustNotExist,path"
              : "baseRevision,doc,kind,mustNotExist,path",
          )
        );
      return (
        op.kind !== "resource_delete" ||
        !isHash(op.baseRevision) ||
        !keys(op, "baseRevision,kind,path")
      );
    })
  )
    return false;
  const seen = new Set<string>();
  for (const entry of plan.readback) {
    if (
      !entry ||
      !keys(entry, "doc,path") ||
      !path(entry.path) ||
      seen.has(entry.path) ||
      (typeof entry.doc !== "string" && entry.doc !== null)
    )
      return false;
    seen.add(entry.path);
  }
  const lock = plan.readback.find((entry) => entry.path === "mdbase.lock.yaml");
  return (
    typeof lock?.doc === "string" &&
    plan.ops.every((op) =>
      plan.readback.some(
        (entry) =>
          entry.path === op.path &&
          entry.doc === (op.kind === "resource_put" ? op.doc : null),
      ),
    )
  );
}
function samePlan(a: ModelPackPlan, b: ModelPackPlan): boolean {
  return (
    a.pack.id === b.pack.id &&
    a.pack.version === b.pack.version &&
    a.pack.digest === b.pack.digest &&
    a.assessmentDigest === b.assessmentDigest &&
    a.ops.length === b.ops.length &&
    a.ops.every((op, i) => {
      const other = b.ops[i]!;
      return (
        op.kind === other.kind &&
        op.path === other.path &&
        op.baseRevision === other.baseRevision &&
        (op.kind === "resource_delete" ||
          (other.kind === "resource_put" &&
            op.doc === other.doc &&
            op.mustNotExist === other.mustNotExist))
      );
    }) &&
    a.readback.length === b.readback.length &&
    a.readback.every(
      (entry, i) =>
        entry.path === b.readback[i]!.path && entry.doc === b.readback[i]!.doc,
    )
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

/** Pack installation on the one original client and original protected journal.
 * Recovery after attempt reconciles the SAME receipt, never a second submit.
 * Pure core assessment/application output is not a remote write witness.
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

  private intent(value: ModelSetupIntent): ModelPackSetupIntent {
    if (value?.version === 1)
      throw blocked(
        "Preserve the original legacy TaskNotes setup intent. It cannot be converted, cleared or resubmitted as a type pack.",
      );
    if (
      !value ||
      value.version !== 2 ||
      !keys(value, "mutationId,phase,plan,scope,version") ||
      !value.scope ||
      !keys(value.scope, "account,collection,installation") ||
      !sameScope(value.scope, this.scope) ||
      typeof value.mutationId !== "string" ||
      !uuid.test(value.mutationId) ||
      value.mutationId === nil ||
      !["prepared", "attempted", "confirmed", "verified"].includes(
        value.phase,
      ) ||
      !validPlan(value.plan) ||
      !value.plan.ops.length ||
      new TextEncoder().encode(JSON.stringify(value)).byteLength >
        MODEL_SETUP_LIMITS.plaintextBytes
    )
      throw blocked(
        "Preserve the original model setup intent; its binding is invalid.",
      );
    const copy = structuredClone(value);
    Object.freeze(copy.scope);
    Object.freeze(copy.plan.pack);
    copy.plan.ops.forEach(Object.freeze);
    Object.freeze(copy.plan.ops);
    copy.plan.readback.forEach(Object.freeze);
    Object.freeze(copy.plan.readback);
    Object.freeze(copy.plan);
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
    if (!this.client.hello.grant.capabilities.includes("definitions.manage"))
      throw new ModelSetupError({
        state: "permission_required",
        message:
          "Approve permission to install the TaskNotes model pack before setting up this collection.",
      });
  }
  private async snapshot(signal: AbortSignal): Promise<Resources> {
    const listed = await this.client.resources.list({ text: true, signal });
    signal.throwIfAborted();
    if (!listed.complete)
      throw blocked("Mdbase has not supplied the complete definition list.");
    const resources: Resources = Object.create(null) as Resources;
    for (const resource of listed.resources) {
      if (
        resource.state !== "confirmed" ||
        typeof resource.text !== "string" ||
        Object.hasOwn(resources, resource.path)
      )
        throw blocked(
          "Mdbase has not supplied a complete confirmed resource snapshot.",
        );
      resources[resource.path] = resource.text;
    }
    return Object.freeze(resources);
  }
  private async freshPlan(signal: AbortSignal): Promise<ModelPackPlan> {
    this.requirePermission();
    try {
      const assessment = await nativeModelPackAssessment(
        await this.snapshot(signal),
        signal,
      );
      if (!assessment.applicable)
        throw blocked(
          "The published TaskNotes pack conflicts with this collection. Existing files will not be overwritten.",
        );
      const plan = await nativeModelPackPlan(
        await this.snapshot(signal),
        assessment.assessment_digest,
        signal,
      );
      if (!validPlan(plan))
        throw blocked(
          "Mdbase did not supply a complete guarded TaskNotes pack plan.",
        );
      return plan;
    } catch (reason) {
      signal.throwIfAborted();
      if (
        reason instanceof CoreError &&
        reason.code === "concurrent_modification"
      )
        throw blocked(
          "The collection changed after assessment. Check setup to explicitly re-assess; no files were submitted or overwritten.",
        );
      if (reason instanceof ModelSetupError) throw reason;
      if (reason instanceof MdbaseError && reason.code === "forbidden")
        throw new ModelSetupError({
          state: "permission_required",
          message:
            "Approve access to the original collection's TaskNotes definitions.",
        });
      throw blocked(
        reason instanceof Error
          ? reason.message
          : "The original TaskNotes pack assessment is unavailable.",
      );
    }
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
      const plan = await this.freshPlan(signal);
      if (!plan.ops.length)
        throw blocked(
          "The current pack has not made the TaskNotes model available. Check its confirmed definitions before continuing.",
        );
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
      const plan = await this.freshPlan(signal);
      if (!plan.ops.length) {
        // A pure current/no-op plan cannot invent a mutation or a completion.
        try {
          await this.readback(plan, signal);
        } catch {
          signal.throwIfAborted();
          throw blocked(
            "The current TaskNotes pack readback is not confirmed. No mutation was created.",
          );
        }
        if (!(await this.modelPresent(signal)))
          throw blocked(
            "The current pack has not made the TaskNotes model available.",
          );
        await this.finish(signal);
        return;
      }
      let intent = this.intent(await this.journal.prepare(plan, signal));
      signal.throwIfAborted();
      if (intent.phase !== "prepared" || !samePlan(intent.plan, plan))
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
        if (await this.modelPresent(signal)) {
          await this.finish(signal);
          return;
        }
        throw blocked(
          "No original TaskNotes setup intent is available to resume.",
        );
      }
      await this.execute(this.intent(stored), signal);
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
    before: ModelPackSetupIntent,
    after: ModelSetupIntent,
    phase: ModelPackSetupIntent["phase"],
  ) {
    const intent = this.intent(after);
    if (
      intent.mutationId !== before.mutationId ||
      !samePlan(intent.plan, before.plan) ||
      intent.phase !== phase
    )
      throw blocked("The original model setup intent changed during recovery.");
    return intent;
  }
  private async readback(
    plan: ModelPackPlan,
    signal: AbortSignal,
  ): Promise<void> {
    const listed = await this.client.resources.list({ text: true, signal });
    signal.throwIfAborted();
    if (!listed.complete) throw uncertain();
    for (const expected of plan.readback) {
      const matches = listed.resources.filter(
        (resource) => resource.path === expected.path,
      );
      if (expected.doc === null) {
        if (matches.length) throw uncertain();
        try {
          await this.client.resources.get(expected.path, signal);
          throw uncertain();
        } catch (reason) {
          if (!(reason instanceof MdbaseError) || reason.code !== "not_found")
            throw reason;
        }
        signal.throwIfAborted();
        continue;
      }
      if (
        matches.length !== 1 ||
        matches[0]!.state !== "confirmed" ||
        matches[0]!.text !== expected.doc
      )
        throw uncertain();
      const resource = await this.client.resources.get(expected.path, signal);
      signal.throwIfAborted();
      if (
        resource.path !== expected.path ||
        resource.state !== "confirmed" ||
        resource.text !== expected.doc ||
        resource.revision !== matches[0]!.revision
      )
        throw uncertain();
    }
  }
  private async execute(
    original: ModelPackSetupIntent,
    signal: AbortSignal,
  ): Promise<ModelPackSetupIntent> {
    let intent = original;
    let receipt: wire.Receipt;
    if (intent.phase === "prepared") {
      const plan = await this.freshPlan(signal);
      if (!samePlan(plan, intent.plan))
        throw blocked(
          "The original pack assessment no longer matches this collection. Preserve its identity and plan; no replacement will be submitted.",
        );
      intent = this.transition(
        intent,
        await this.journal.recordAttempt(intent.mutationId, signal),
        "attempted",
      );
      signal.throwIfAborted();
      try {
        const writes = await this.client.submit([...intent.plan.ops], {
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
        "Mdbase did not accept the original TaskNotes pack setup. Its identity is retained; re-assess the collection without overwriting or submitting a replacement.",
      );
    if (receipt.state !== "confirmed") throw uncertain();
    try {
      if (intent.phase === "attempted")
        intent = this.transition(
          intent,
          await this.journal.recordConfirmed(intent.mutationId, signal),
          "confirmed",
        );
      await this.readback(intent.plan, signal);
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
