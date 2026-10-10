import { MdbaseError, type MdbaseClient, type wire } from "@mdbase-dev/sdk";
import type { Resources } from "mdbase";
import {
  ModelSetupError,
  TaskNotesModelRequiredError,
  MODEL_SETUP_LIMITS,
  type ModelResourcePlan,
  type ResourceSetupIntent,
  type ModelResourceSetupJournal,
  type ModelSetupIntent,
  type ModelSetupProgressListener,
  type ModelSetupView,
  type TaskNotesModelSetup,
} from "../application/ports/model-setup";
import { decode, modelResourcePlan } from "../cloud/next-model-setup-intent";
import { TASKNOTES_REQUEST_BUDGETS } from "../cloud/request-budgets";
import bases from "../../vendor/obsidian-base-1.0.0.json";
import { modelResourceInventory } from "./next-model-resources";
import { requireSetupAvailability } from "./next-setup-availability";
import {
  atomicSetupOperation,
  setupStillPending,
} from "./next-setup-operation";
import {
  iterateNativeDiscovery,
  nativeViewSelection,
} from "./next-bases-discovery";
import { nextTaskProviders } from "./next-task-catalog";
import { TASKNOTES_DEFAULT_VIEW_SOURCES } from "../domain/default-view-source";
import {
  captureResourceSetupPlan,
  nativeResourceSetupAssessment,
  recheckPreparedResourceSetup,
  type DefaultSourceFactory,
  type ResourceSetupAssessment,
} from "./next-resource-plan";

import {
  captureOriginalSetupRecovery,
  recheckOriginalSetupRecovery,
} from "./next-original-setup-recovery";

const uncertain = () =>
  new ModelSetupError({
    state: "outcome_unknown",
    message:
      "Preserve this collection and resume its original resource setup. Confirmation or exact native readback is unfinished.",
  });
const blocked = (message: string) =>
  new ModelSetupError({ state: "blocked", message });
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const confirmed = (record: wire.RecordView) =>
  record.state.state === "confirmed" &&
  !record.state.hold &&
  !record.state.unresolved;
const readableSource = (record: wire.RecordView) =>
  (record.state.state === "pending" || record.state.state === "confirmed") &&
  !record.state.hold &&
  !record.state.unresolved;

/** Resource-components + ordinary Creates on ONE held client/original journal.
 * Existing v1/v2 recovery remains in NativeModelSetup, never converted here.
 * This seam does not activate source-write capabilities or qualify native writes.
 */
export class NativeResourceSetup implements TaskNotesModelSetup {
  private readonly scope;
  private tail: Promise<void> = Promise.resolve();
  constructor(
    private readonly client: MdbaseClient,
    private readonly journal: ModelResourceSetupJournal,
    private readonly ownerSignal: () => AbortSignal,
    private readonly sources: DefaultSourceFactory,
    private readonly verified: (signal: AbortSignal) => Promise<void>,
    private readonly legacy?: (signal: AbortSignal) => TaskNotesModelSetup,
  ) {
    this.scope = Object.freeze({ ...journal.scope });
  }

  private signal(
    budget: number = TASKNOTES_REQUEST_BUDGETS.foregroundMs,
  ): AbortSignal {
    const owner = this.ownerSignal();
    owner.throwIfAborted();
    if (
      !same(this.scope, this.journal.scope) ||
      this.client.hello.collection !== this.scope.collection
    )
      throw blocked(
        "The original resource setup collection binding is unavailable.",
      );
    return budget
      ? AbortSignal.any([owner, AbortSignal.timeout(budget)])
      : owner;
  }
  private intent(value: ModelSetupIntent): ResourceSetupIntent {
    const original = decode(value, this.scope);
    if (original.version !== 3 && original.version !== 4)
      throw blocked(
        "Preserve and resume the original legacy/model-pack intent.",
      );
    return original;
  }
  private verifyPrevious(value: ModelSetupIntent, signal: AbortSignal): void {
    // Scoped VERIFIED history is not a mutable byte snapshot guard.
    value = decode(value, this.scope);
    signal.throwIfAborted();
    if (value.phase !== "verified") throw uncertain();
  }
  private async requiredPacks(signal: AbortSignal): Promise<string[]> {
    await this.snapshot(signal); // Complete confirmed inventory, never a cache.
    let task = true;
    try {
      await nextTaskProviders(this.client, signal);
    } catch (reason) {
      signal.throwIfAborted();
      if (!(reason instanceof TaskNotesModelRequiredError)) throw reason;
      task = false;
    }
    const catalog = await this.client.describe(signal);
    signal.throwIfAborted();
    const base =
      catalog.contracts.some(
        (c) =>
          c.id === "obsidian.base" &&
          c.version === "1.0.0" &&
          c.digest === bases.provides[0]!.digest,
      ) &&
      catalog.types.some((t) =>
        t.implements.some(
          (c) => c.contract === "obsidian.base" && c.version === "1.0.0",
        ),
      );
    return [
      ...(!task ? ["tasknotes.task"] : []),
      ...(!base ? ["obsidian.base"] : []),
    ];
  }
  private offeredPacks(
    missing: readonly string[],
    history: boolean,
  ): readonly string[] {
    return !history && missing.includes("tasknotes.task")
      ? [
          "tasknotes.task",
          "tasknotes.scratch",
          "tasknotes.scratch-image",
          ...missing.filter((id) => id !== "tasknotes.task"),
        ]
      : missing;
  }
  private requirePermission(
    plan: Pick<ResourceSetupAssessment, "resourceOps" | "sources">,
  ) {
    const g = this.client.hello.grant;
    if (
      !g.capabilities.includes("collection.read") ||
      g.role === "viewer" ||
      (plan.resourceOps.length &&
        !g.capabilities.includes("definitions.manage")) ||
      (plan.sources.length &&
        (!g.capabilities.includes("records.create") ||
          g.fileFolders !== undefined))
    )
      throw new ModelSetupError({
        state: "permission_required",
        message:
          "Approve the original collection's definition setup and full-scope source creation permissions.",
      });
  }
  private async snapshot(signal: AbortSignal): Promise<Resources> {
    const inventory = await modelResourceInventory(this.client, signal);
    signal.throwIfAborted();
    const data: Resources = Object.create(null);
    for (const r of inventory) data[r.path] = r.text!;
    return Object.freeze(data);
  }
  private exclusive(work: () => Promise<void>): Promise<void> {
    const result = this.tail.then(work);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async inspect(): Promise<ModelSetupView> {
    const signal = this.signal();
    try {
      requireSetupAvailability(this.client.status);
      const stored = await this.journal.load(signal);
      requireSetupAvailability(this.client.status);
      signal.throwIfAborted();
      if (stored) {
        if (stored.phase !== "verified") {
          if (stored.version < 3 && this.legacy)
            return await this.legacy(signal).inspect();
          this.intent(stored);
          return uncertain().view;
        }
        this.verifyPrevious(stored, signal);
      }
      const missing = await this.requiredPacks(signal);
      if (!missing.length) {
        await this.currentReadback(signal);
        return { state: "ready" };
      }
      const assessment = await nativeResourceSetupAssessment(
        await this.snapshot(signal),
        this.client,
        this.sources,
        signal,
        stored !== null,
        this.offeredPacks(missing, stored !== null),
      );
      requireSetupAvailability(this.client.status);
      this.requirePermission(assessment);
      return { state: "required" };
    } catch (reason) {
      signal.throwIfAborted();
      if (reason instanceof ModelSetupError) return reason.view;
      return {
        state: "blocked",
        message:
          reason instanceof Error
            ? reason.message
            : "Original resource setup is unavailable.",
      };
    }
  }
  private async operation(
    work: (signal: AbortSignal) => Promise<void>,
    progress?: ModelSetupProgressListener,
    reconcile: (signal: AbortSignal) => Promise<void> = (signal) =>
      this.reconcile(signal),
  ): Promise<void> {
    // Pin at the explicit action, BEFORE the serialization queue yields.
    const owner = this.signal(0);
    return this.exclusive(() =>
      atomicSetupOperation(
        owner,
        (signal) => {
          requireSetupAvailability(this.client.status);
          return work(signal);
        },
        reconcile,
        progress,
      ),
    );
  }
  private async reconcile(signal: AbortSignal): Promise<void> {
    requireSetupAvailability(this.client.status);
    const stored = await this.journal.load(signal);
    signal.throwIfAborted();
    if (!stored || stored.phase === "prepared") setupStillPending();
    if (stored.phase === "verified") {
      this.verifyPrevious(stored, signal);
      await this.completeCurrent(signal);
      return;
    }
    if (stored.version < 3 && this.legacy) {
      if (stored.version !== 2) setupStillPending();
      await this.legacy(signal).resume();
      return;
    }
    // execute's attempted/confirmed/verified branches ONLY await the original
    // receipt and verify readback. Never run the prepared/submit branch here.
    await this.execute(this.intent(stored), signal);
  }
  install(progress?: ModelSetupProgressListener): Promise<void> {
    return this.operation(async (signal) => {
      const stored = await this.journal.load(signal);
      signal.throwIfAborted();
      if (stored && stored.phase !== "verified") {
        if (stored.version < 3 && this.legacy) {
          await this.legacy(signal).install(progress);
          return;
        }
        await this.execute(this.intent(stored), signal, progress);
        return;
      }
      if (stored) this.verifyPrevious(stored, signal);
      const missing = await this.requiredPacks(signal);
      if (!missing.length) {
        await this.completeCurrent(signal);
        return;
      }
      const assessment = await nativeResourceSetupAssessment(
        await this.snapshot(signal),
        this.client,
        this.sources,
        signal,
        stored !== null,
        this.offeredPacks(missing, stored !== null),
      );
      signal.throwIfAborted();
      requireSetupAvailability(this.client.status);
      if (
        !assessment.resourceOps.some(
          (op) =>
            ![
              "mdbase.yaml",
              "mdbase.lock.yaml",
              "mdbase.provisions.yaml",
            ].includes(op.path),
        )
      )
        throw blocked(
          "Current compatible models are missing. The factory offer cannot restore a deliberately deleted seed; restore or supply an implementing model explicitly. Completed history is unchanged.",
        );
      this.requirePermission(assessment);
      // Every original record UUID/source is captured before the first durable prepare await.
      const plan = modelResourcePlan(captureResourceSetupPlan(assessment));
      if (stored && !this.journal.prepareResourceRound)
        throw blocked(
          "The original journal cannot retain an additive setup round.",
        );
      const intent = this.intent(
        stored
          ? await this.journal.prepareResourceRound!(
              plan,
              stored.mutationId,
              signal,
            )
          : await this.journal.prepareResources(plan, signal),
      );
      if (stored && (intent.version !== 4 || !same(intent.previous, stored)))
        throw uncertain();
      signal.throwIfAborted();
      if (!same(intent.plan, plan)) throw uncertain();
      await this.execute(intent, signal, progress);
    }, progress);
  }
  resume(progress?: ModelSetupProgressListener): Promise<void> {
    return this.operation(async (signal) => {
      const stored = await this.journal.load(signal);
      signal.throwIfAborted();
      if (!stored)
        throw blocked("No original resource mutation is available to resume.");
      if (stored.phase === "verified") {
        this.verifyPrevious(stored, signal);
        await this.completeCurrent(signal);
        return;
      }
      if (stored.version < 3 && this.legacy) {
        await this.legacy(signal).resume(progress);
        return;
      }
      await this.execute(this.intent(stored), signal, progress);
    }, progress);
  }
  async recoverOriginal(
    value: ModelSetupIntent,
    progress?: ModelSetupProgressListener,
  ): Promise<void> {
    const original = captureOriginalSetupRecovery(value, this.scope);
    const recover = async (signal: AbortSignal) => {
      requireSetupAvailability(this.client.status);
      const stored = await this.journal.load(signal);
      signal.throwIfAborted();
      const current = recheckOriginalSetupRecovery(
        original,
        stored,
        this.scope,
      );
      if (current.version === 2) {
        const legacy = this.legacy?.(signal);
        if (!legacy?.recoverOriginal)
          throw blocked("Original model-pack recovery is unavailable.");
        await legacy.recoverOriginal(original, progress);
        signal.throwIfAborted();
        return;
      }
      // The admitted phase and immutable identity are rechecked INSIDE both
      // operation windows. No load-then-general-resume or prepared submit path.
      await this.execute(this.intent(current), signal, progress);
    };
    return this.operation(recover, progress, recover);
  }
  private transition(
    before: ResourceSetupIntent,
    after: ResourceSetupIntent,
    phase: ResourceSetupIntent["phase"],
  ) {
    const result = this.intent(after);
    if (
      result.mutationId !== before.mutationId ||
      result.version !== before.version ||
      (before.version === 4 &&
        (result.version !== 4 || !same(before.previous, result.previous))) ||
      !same(result.plan, before.plan) ||
      result.phase !== phase
    )
      throw blocked("The original resource intent changed during recovery.");
    return result;
  }
  private async execute(
    original: ResourceSetupIntent,
    signal: AbortSignal,
    progress?: ModelSetupProgressListener,
  ): Promise<void> {
    requireSetupAvailability(this.client.status);
    let intent = original;
    if (intent.version === 4) this.verifyPrevious(intent.previous, signal);
    if (intent.phase === "verified") {
      await this.completeCurrent(signal);
      return;
    }
    let receipt: wire.Receipt;
    if (intent.phase === "prepared") {
      this.requirePermission(intent.plan);
      // Pure resource reassessment ONLY. No file absence check, new source, UUID,
      // source generator, lock reconstruction or planner fallback.
      await recheckPreparedResourceSetup(
        await this.snapshot(signal),
        intent.plan,
        signal,
        intent.version === 4,
      );
      requireSetupAvailability(this.client.status);
      intent = this.transition(
        intent,
        await this.journal.recordResourceAttempt(intent.mutationId, signal),
        "attempted",
      );
      signal.throwIfAborted();
      try {
        const writes = await this.client.submit(
          [
            ...intent.plan.resourceOps,
            ...intent.plan.sources.map((s): wire.Op => ({
              kind: "create",
              id: s.id,
              path: s.path,
              document: s.document,
            })),
          ],
          { mutationId: intent.mutationId, signal },
        );
        signal.throwIfAborted();
        if (
          writes.length !== 1 ||
          writes[0]!.receipt.mutation !== intent.mutationId
        )
          throw uncertain();
        progress?.("waiting_for_confirmation");
        receipt = await this.wait(writes[0]!.confirmed, signal);
      } catch (reason) {
        signal.throwIfAborted();
        // A typed native refusal is not transformed into overwrite/retry.
        if (reason instanceof MdbaseError) throw reason;
        throw uncertain();
      }
    } else {
      progress?.("waiting_for_confirmation");
      try {
        receipt = await this.client.awaitReceipt(
          intent.mutationId,
          TASKNOTES_REQUEST_BUDGETS.atomicSetupMs,
          signal,
        );
      } catch {
        signal.throwIfAborted();
        throw uncertain();
      }
    }
    signal.throwIfAborted();
    if (receipt.mutation !== intent.mutationId) throw uncertain();
    if (receipt.state === "rejected") {
      if (receipt.problem) throw new MdbaseError(receipt.problem);
      throw blocked(
        "Mdbase refused the original resource setup. Its identity and plan are retained; no replacement will be submitted.",
      );
    }
    if (
      receipt.state !== "confirmed" ||
      receipt.status === "conflicted" ||
      receipt.conflicts?.length
    )
      throw uncertain();
    try {
      // Records are optional in the wire. For an applied original receipt
      // without them, exact bounded readback must succeed BEFORE advancing the
      // attempted journal. A refusal/mismatch retains its original recovery state.
      const receiptRecords = receipt.records;
      const recordsOmitted = receiptRecords === undefined;
      if (recordsOmitted) {
        if (receipt.status !== "applied") throw uncertain();
        await this.readback(intent.plan, signal);
      } else {
        for (const source of intent.plan.sources) {
          const records = receiptRecords.filter(
            (r) => r.id === source.id && r.path === source.path,
          );
          if (records.length !== 1) throw uncertain();
        }
      }
      if (intent.phase === "attempted")
        intent = this.transition(
          intent,
          await this.journal.recordResourceConfirmed(intent.mutationId, signal),
          "confirmed",
        );
      if (!recordsOmitted) await this.readback(intent.plan, signal);
      if (intent.phase === "confirmed")
        intent = this.transition(
          intent,
          await this.journal.recordResourceVerified(intent.mutationId, signal),
          "verified",
        );
      if (intent.phase !== "verified") throw uncertain();
      await this.finish(signal);
    } catch {
      signal.throwIfAborted();
      throw uncertain();
    }
  }
  private async wait<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    let cancel!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      cancel = () => reject(signal.reason);
      signal.addEventListener("abort", cancel, { once: true });
    });
    try {
      return await Promise.race([promise, aborted]);
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }
  private async completeCurrent(signal: AbortSignal): Promise<void> {
    if ((await this.requiredPacks(signal)).length)
      throw blocked(
        "Current models need explicit setup; completed history is retained.",
      );
    await this.currentReadback(signal);
    await this.finish(signal);
  }
  private async currentReadback(signal: AbortSignal): Promise<void> {
    try {
      await this.readback(undefined, signal);
      requireSetupAvailability(this.client.status);
    } catch {
      signal.throwIfAborted();
      throw blocked(
        "Current resource/source readback is unconfirmed. No mutation or UUID was created.",
      );
    }
  }
  private async readback(
    plan: ModelResourcePlan | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const currentSources =
      plan === undefined || plan.sourcePolicy === "current-only";
    const inventory = await modelResourceInventory(this.client, signal);
    signal.throwIfAborted();
    for (const expected of plan?.resourceReadback ?? []) {
      const found = inventory.filter((r) => r.path === expected.path);
      if (expected.doc === null) {
        if (found.length) throw uncertain();
        try {
          await this.client.resources.get(expected.path, signal);
          throw uncertain();
        } catch (reason) {
          if (!(reason instanceof MdbaseError) || reason.code !== "not_found")
            throw reason;
        }
      } else {
        if (
          found.length !== 1 ||
          found[0]!.text !== expected.doc ||
          found[0]!.state !== "confirmed"
        )
          throw uncertain();
        const r = await this.client.resources.get(expected.path, signal);
        if (
          r.path !== expected.path ||
          r.text !== expected.doc ||
          r.state !== "confirmed" ||
          r.revision !== found[0]!.revision
        )
          throw uncertain();
      }
      signal.throwIfAborted();
    }
    await nextTaskProviders(this.client, signal);
    const catalog = await this.client.describe(signal);
    signal.throwIfAborted();
    const contract = catalog.contracts.find(
      (c) =>
        c.id === "obsidian.base" &&
        c.version === "1.0.0" &&
        c.digest === bases.provides[0]!.digest,
    );
    if (
      !contract ||
      !catalog.types.some((t) =>
        t.implements.some(
          (i) => i.contract === contract.id && i.version === contract.version,
        ),
      )
    )
      throw uncertain();
    const records = new Map<string, wire.RecordView>();
    for (const source of plan?.sources ?? []) {
      const record = await this.client.get(
        source.id,
        { document: true },
        signal,
      );
      const atPath = await this.client.get(
        { path: source.path },
        { document: true },
        signal,
      );
      signal.throwIfAborted();
      if (
        record.id !== source.id ||
        record.path !== source.path ||
        record.document !== source.document ||
        !confirmed(record) ||
        atPath.id !== record.id ||
        atPath.path !== record.path ||
        atPath.document !== record.document ||
        atPath.revision !== record.revision ||
        !confirmed(atPath) ||
        !catalog.types.some(
          (t) =>
            record.types.includes(t.name) &&
            t.implements.some(
              (i) =>
                i.contract === contract.id && i.version === contract.version,
            ),
        )
      )
        throw uncertain();
      records.set(source.id, record);
    }
    const observed = new Set<string>();
    const defaultPaths = new Set(
      TASKNOTES_DEFAULT_VIEW_SOURCES.map((s) => s.path),
    );
    const readPaths = new Set<string>();
    let pages = 0,
      bytes = 0;
    for await (const views of iterateNativeDiscovery(async (continuation) => {
      if (++pages > MODEL_SETUP_LIMITS.readbacks) throw uncertain();
      const result = await this.client.listAppBasesViews(
        { captureTimezone: "UTC", limit: 128, continuation },
        signal,
      );
      signal.throwIfAborted();
      if (result.kind === "refusal") throw new MdbaseError(result.problem);
      bytes += new TextEncoder().encode(JSON.stringify(result)).byteLength;
      if (bytes > MODEL_SETUP_LIMITS.plaintextBytes) throw uncertain();
      return result;
    }, signal))
      for (const view of views) {
        const created = records.get(view.record);
        if (!currentSources && !created && !defaultPaths.has(view.path))
          continue;
        if (created && view.ordinal !== 0) throw uncertain();
        if (!currentSources && readPaths.has(view.path)) continue; // Original factory readback semantics.
        const record =
          created ??
          (await this.client.get(view.record, { document: true }, signal));
        const holder = await this.client.get(
          { path: view.path },
          { document: true },
          signal,
        );
        signal.throwIfAborted();
        if (
          view.path !== record.path ||
          view.record !== record.id ||
          view.sourceRevision !== record.revision ||
          !(currentSources ? readableSource(record) : confirmed(record)) ||
          typeof record.document !== "string" ||
          holder.id !== record.id ||
          holder.path !== record.path ||
          holder.revision !== record.revision ||
          holder.document !== record.document ||
          !(currentSources ? readableSource(holder) : confirmed(holder)) ||
          !catalog.types.some(
            (t) =>
              record.types.includes(t.name) &&
              t.implements.some(
                (i) =>
                  i.contract === contract.id && i.version === contract.version,
              ),
          )
        )
          throw uncertain();
        const result = await this.client.readAppBasesViewSource(
          { ...nativeViewSelection(view), captureTimezone: "UTC" },
          signal,
        );
        signal.throwIfAborted();
        if (result.kind === "refusal") throw new MdbaseError(result.problem);
        if (
          result.view.record !== view.record ||
          result.view.path !== view.path ||
          result.view.sourceRevision !== view.sourceRevision ||
          result.view.ordinal !== view.ordinal ||
          result.source !== record.document
        )
          throw uncertain();
        readPaths.add(view.path);
        if (created) observed.add(created.id);
      }
    if (
      observed.size !== records.size ||
      (!currentSources && [...defaultPaths].some((p) => !readPaths.has(p)))
    )
      throw uncertain();
  }
  private async finish(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    try {
      await this.verified(signal);
      signal.throwIfAborted();
    } catch {
      throw uncertain();
    }
  }
}
