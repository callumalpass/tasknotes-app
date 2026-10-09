/** Public collection binding only; never credentials or a readiness witness. */
export interface ModelSetupScope {
  readonly account: string;
  readonly installation: string;
  readonly collection: string;
}

export interface ModelDefinitionPut {
  readonly kind: "resource_put";
  readonly path: string;
  readonly doc: string;
  readonly mustNotExist: true;
}

/** Exactly the inline contract and implementing-type documents, in that order. */
export type ModelDefinitionOps = readonly [
  ModelDefinitionPut,
  ModelDefinitionPut,
];

export interface ModelSetupIntent {
  readonly version: 1;
  readonly scope: ModelSetupScope;
  readonly mutationId: string;
  readonly ops: ModelDefinitionOps;
  readonly phase: "prepared" | "attempted" | "confirmed" | "verified";
}

/** One bounded intent owned by the original installation/collection controller.
 * Mutators commit durably before returning, retain the original tuple/ID/ops,
 * and use monotonic compare-and-set. No generic save, reset or removal is exposed.
 * Phase metadata never substitutes for an actual receipt or source readback.
 */
export interface ModelSetupJournal {
  readonly scope: ModelSetupScope;
  load(signal: AbortSignal): Promise<ModelSetupIntent | null>;
  prepare(
    ops: ModelDefinitionOps,
    signal: AbortSignal,
  ): Promise<ModelSetupIntent>;
  recordAttempt(id: string, signal: AbortSignal): Promise<ModelSetupIntent>;
  recordConfirmed(id: string, signal: AbortSignal): Promise<ModelSetupIntent>;
  recordVerified(id: string, signal: AbortSignal): Promise<ModelSetupIntent>;
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
