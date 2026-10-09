import { MdbaseError, type MdbaseClient, type wire } from "@mdbase-dev/sdk";
import type { Resources } from "mdbase";
import {
  ModelSetupError,
  MODEL_SETUP_LIMITS,
  type ModelResourcePlan,
  type ModelResourceSetupIntent,
  type ModelResourceSetupJournal,
  type ModelSetupIntent,
  type ModelSetupView,
  type TaskNotesModelSetup,
} from "../application/ports/model-setup";
import { modelResourcePlan } from "../cloud/next-model-setup-intent";
import { TASKNOTES_REQUEST_BUDGETS } from "../cloud/request-budgets";
import bases from "../../vendor/obsidian-base-1.0.0.json";
import { modelResourceInventory } from "./next-model-resources";
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
    private readonly verified: () => Promise<void>,
  ) {
    this.scope = Object.freeze({ ...journal.scope });
  }

  private signal(): AbortSignal {
    const owner = this.ownerSignal();
    owner.throwIfAborted();
    if (
      !same(this.scope, this.journal.scope) ||
      this.client.hello.collection !== this.scope.collection
    )
      throw blocked(
        "The original resource setup collection binding is unavailable.",
      );
    return AbortSignal.any([
      owner,
      AbortSignal.timeout(TASKNOTES_REQUEST_BUDGETS.foregroundMs),
    ]);
  }
  private intent(value: ModelSetupIntent): ModelResourceSetupIntent {
    if (!value || value.version !== 3)
      throw blocked(
        "Preserve and resume the original legacy/model-pack intent. It cannot be enlarged into resource setup.",
      );
    if (
      Object.keys(value).sort().join() !==
        "mutationId,phase,plan,scope,version" ||
      !same(value.scope, this.scope) ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value.mutationId) ||
      value.mutationId === "00000000-0000-0000-0000-000000000000" ||
      !["prepared", "attempted", "confirmed", "verified"].includes(value.phase)
    )
      throw blocked("The original resource setup binding is invalid.");
    return Object.freeze({
      ...value,
      scope: this.scope,
      plan: modelResourcePlan(value.plan),
    });
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
      const stored = await this.journal.load(signal);
      signal.throwIfAborted();
      if (stored) {
        const original = this.intent(stored);
        if (original.phase !== "verified") return uncertain().view;
        try {
          await this.readback(original.plan, signal);
        } catch {
          signal.throwIfAborted();
          throw uncertain();
        }
        return { state: "ready" };
      }
      const assessment = await nativeResourceSetupAssessment(
        await this.snapshot(signal),
        this.client,
        this.sources,
        signal,
      );
      if (assessment.resourceOps.length || assessment.sources.length) {
        this.requirePermission(assessment);
        return { state: "required" };
      }
      await this.currentReadback({ ...assessment, sources: [] }, signal);
      return { state: "ready" };
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
  install(): Promise<void> {
    return this.exclusive(async () => {
      const signal = this.signal();
      const stored = await this.journal.load(signal);
      signal.throwIfAborted();
      if (stored) {
        await this.execute(this.intent(stored), signal);
        return;
      }
      const assessment = await nativeResourceSetupAssessment(
        await this.snapshot(signal),
        this.client,
        this.sources,
        signal,
      );
      signal.throwIfAborted();
      if (!assessment.resourceOps.length && !assessment.sources.length) {
        await this.currentReadback({ ...assessment, sources: [] }, signal);
        await this.finish(signal);
        return;
      }
      this.requirePermission(assessment);
      // Every original record UUID/source is captured before the first durable prepare await.
      const plan = modelResourcePlan(captureResourceSetupPlan(assessment));
      const intent = this.intent(
        await this.journal.prepareResources(plan, signal),
      );
      signal.throwIfAborted();
      if (!same(intent.plan, plan)) throw uncertain();
      await this.execute(intent, signal);
    });
  }
  resume(): Promise<void> {
    return this.exclusive(async () => {
      const signal = this.signal();
      const stored = await this.journal.load(signal);
      signal.throwIfAborted();
      if (!stored)
        throw blocked("No original resource mutation is available to resume.");
      await this.execute(this.intent(stored), signal);
    });
  }
  private transition(
    before: ModelResourceSetupIntent,
    after: ModelResourceSetupIntent,
    phase: ModelResourceSetupIntent["phase"],
  ) {
    const result = this.intent(after);
    if (
      result.mutationId !== before.mutationId ||
      !same(result.plan, before.plan) ||
      result.phase !== phase
    )
      throw blocked("The original resource intent changed during recovery.");
    return result;
  }
  private async execute(
    original: ModelResourceSetupIntent,
    signal: AbortSignal,
  ): Promise<void> {
    let intent = original;
    let receipt: wire.Receipt;
    if (intent.phase === "prepared") {
      this.requirePermission(intent.plan);
      // Pure resource reassessment ONLY. No file absence check, new source, UUID,
      // source generator, lock reconstruction or planner fallback.
      await recheckPreparedResourceSetup(
        await this.snapshot(signal),
        intent.plan,
        signal,
      );
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
        receipt = await this.wait(writes[0]!.confirmed, signal);
      } catch (reason) {
        signal.throwIfAborted();
        // A typed native refusal is not transformed into overwrite/retry.
        if (reason instanceof MdbaseError) throw reason;
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
      // Confirmed original receipt AND each original record identity are required.
      for (const source of intent.plan.sources) {
        const records =
          receipt.records?.filter(
            (r) => r.id === source.id && r.path === source.path,
          ) ?? [];
        if (records.length !== 1) throw uncertain();
      }
      if (intent.phase === "attempted")
        intent = this.transition(
          intent,
          await this.journal.recordResourceConfirmed(intent.mutationId, signal),
          "confirmed",
        );
      await this.readback(intent.plan, signal);
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
  private async currentReadback(
    plan: ModelResourcePlan,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      await this.readback(plan, signal);
    } catch {
      signal.throwIfAborted();
      throw blocked(
        "Current resource/source readback is unconfirmed. No mutation or UUID was created.",
      );
    }
  }
  private async readback(
    plan: ModelResourcePlan,
    signal: AbortSignal,
  ): Promise<void> {
    const inventory = await modelResourceInventory(this.client, signal);
    signal.throwIfAborted();
    for (const expected of plan.resourceReadback) {
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
    if (!contract) throw uncertain();
    const records = new Map<string, wire.RecordView>();
    for (const source of plan.sources) {
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
        if (!created && !defaultPaths.has(view.path)) continue;
        if (created && view.ordinal !== 0) throw uncertain();
        if (readPaths.has(view.path)) continue; // Existing user source may have multiple views.
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
          !confirmed(record) ||
          typeof record.document !== "string" ||
          holder.id !== record.id ||
          holder.path !== record.path ||
          holder.revision !== record.revision ||
          holder.document !== record.document ||
          !confirmed(holder) ||
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
      [...defaultPaths].some((p) => !readPaths.has(p))
    )
      throw uncertain();
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
}
