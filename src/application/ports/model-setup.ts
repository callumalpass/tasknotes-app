/** Public collection binding only; never credentials or a readiness witness. */
export interface ModelSetupScope {
  readonly account: string;
  readonly installation: string;
  readonly collection: string;
}

export type ModelSetupPhase =
  "prepared" | "attempted" | "confirmed" | "verified";

/** Retained solely to recognize the original v1 plaintext. Never submit,
 * convert, clear or replace a legacy intent, including a prepared one.
 */
export interface LegacyModelSetupIntent {
  readonly version: 1;
  readonly scope: ModelSetupScope;
  readonly mutationId: string;
  readonly ops: readonly [
    {
      readonly kind: "resource_put";
      readonly path: string;
      readonly doc: string;
      readonly mustNotExist: true;
    },
    {
      readonly kind: "resource_put";
      readonly path: string;
      readonly doc: string;
      readonly mustNotExist: true;
    },
  ];
  readonly phase: ModelSetupPhase;
}

/** Original ordered core pack operations, structurally SDK-shaped. The
 * provider-neutral port does not expose a client or rebuild intent from a diff.
 */
export type ModelPackOperation =
  | {
      readonly kind: "resource_put";
      readonly path: string;
      readonly doc: string;
      readonly baseRevision?: string;
      readonly mustNotExist: boolean;
    }
  | {
      readonly kind: "resource_delete";
      readonly path: string;
      readonly baseRevision?: string;
    };

export interface ModelPackPlan {
  readonly pack: {
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly assessmentDigest: string;
  readonly ops: readonly ModelPackOperation[];
  /** ALL installed/preserved targets and the exact assessed lock document.
   * Null is confirmed absence of a core-retired/deleted target, never a missing
   * snapshot fallback. Phase/catalog metadata is not a readback witness.
   */
  readonly readback: readonly {
    readonly path: string;
    readonly doc: string | null;
  }[];
}

export interface ModelPackSetupIntent {
  readonly version: 2;
  readonly scope: ModelSetupScope;
  readonly mutationId: string;
  readonly plan: ModelPackPlan;
  readonly phase: ModelSetupPhase;
}
/** New immutable resource-components + explicit create setup. No file-absence witness. */
export interface ModelResourcePlan {
  readonly assessmentDigest: string;
  readonly provisionDigest: string;
  readonly packs: readonly {
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  }[];
  readonly resourceOps: readonly ModelPackOperation[];
  readonly resourceReadback: readonly {
    readonly path: string;
    readonly doc: string | null;
  }[];
  /** Original record identities are captured before any asynchronous prepare. */
  readonly sources: readonly {
    readonly id: string;
    readonly path: string;
    readonly document: string;
  }[];
}
export interface ModelResourceSetupIntent {
  readonly version: 3;
  readonly scope: ModelSetupScope;
  readonly mutationId: string;
  readonly plan: ModelResourcePlan;
  readonly phase: ModelSetupPhase;
}
export type ModelSetupIntent =
  LegacyModelSetupIntent | ModelPackSetupIntent | ModelResourceSetupIntent;

/** Bounds apply to the TOTAL UTF-8 encoded intent plaintext, not each document.
 * Overflow refuses; never truncate, split, reset or invent a replacement ID.
 */
export const MODEL_SETUP_LIMITS = Object.freeze({
  plaintextBytes: 512 * 1024,
  operations: 64,
  readbacks: 128,
  pathCodeUnits: 1024,
});

/** One bounded intent on the ORIGINAL protected journal/envelope/collection.
 * Mutators commit durably, retain the entire original tuple/ID/plan, and use
 * monotonic CAS. Legacy v1 loads only to preserve/refuse; no mutator accepts it.
 * No generic save, reset, remove or alternate namespace is exposed.
 */
export interface ModelSetupJournal {
  readonly scope: ModelSetupScope;
  load(signal: AbortSignal): Promise<ModelSetupIntent | null>;
  prepare(
    plan: ModelPackPlan,
    signal: AbortSignal,
  ): Promise<ModelPackSetupIntent>;
  recordAttempt(id: string, signal: AbortSignal): Promise<ModelPackSetupIntent>;
  recordConfirmed(
    id: string,
    signal: AbortSignal,
  ): Promise<ModelPackSetupIntent>;
  recordVerified(
    id: string,
    signal: AbortSignal,
  ): Promise<ModelPackSetupIntent>;
}

/** Same protected ledger/tuple; v3 prepare only when its original slot is absent.
 * Existing v1/v2 intents are never converted, enlarged, reset or replaced.
 */
export interface ModelResourceSetupJournal extends ModelSetupJournal {
  prepareResources(
    plan: ModelResourcePlan,
    signal: AbortSignal,
  ): Promise<ModelResourceSetupIntent>;
  recordResourceAttempt(
    id: string,
    signal: AbortSignal,
  ): Promise<ModelResourceSetupIntent>;
  recordResourceConfirmed(
    id: string,
    signal: AbortSignal,
  ): Promise<ModelResourceSetupIntent>;
  recordResourceVerified(
    id: string,
    signal: AbortSignal,
  ): Promise<ModelResourceSetupIntent>;
}

export type ModelSetupView =
  | { readonly state: "required" }
  | { readonly state: "ready" }
  | { readonly state: "outcome_unknown"; readonly message: string }
  | { readonly state: "blocked"; readonly message: string }
  | { readonly state: "permission_required"; readonly message: string };

/** Provider-neutral explicit model installation and original-intent recovery. */
export interface TaskNotesModelSetup {
  inspect(): Promise<ModelSetupView>;
  install(): Promise<void>;
  resume(): Promise<void>;
}

/** A setup failure carries a display/recovery state, not a write witness. */
export class ModelSetupError extends Error {
  constructor(readonly view: Extract<ModelSetupView, { message: string }>) {
    super(view.message);
    this.name = "ModelSetupError";
  }
}

/** Missing definitions must not select a default schema or render task views. */
export class TaskNotesModelRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskNotesModelRequiredError";
  }
}
