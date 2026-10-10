/** Shared original journal/intent definitions; no app codec or alternate ledger. */
export { APP_COLLECTION_SETUP_LIMITS as MODEL_SETUP_LIMITS } from "@mdbase-dev/sdk/app-host";
export type {
  AppModelSetupScope as ModelSetupScope,
  AppModelSetupPhase as ModelSetupPhase,
  AppLegacyModelSetupIntent as LegacyModelSetupIntent,
  AppModelPackOperation as ModelPackOperation,
  AppModelPackPlan as ModelPackPlan,
  AppModelPackSetupIntent as ModelPackSetupIntent,
  AppModelResourcePlan as ModelResourcePlan,
  AppModelResourceSetupIntent as ModelResourceSetupIntent,
  AppModelResourceSetupRoundIntent as ModelResourceSetupRoundIntent,
  AppResourceSetupIntent as ResourceSetupIntent,
  AppModelSetupIntent as ModelSetupIntent,
  AppModelSetupJournal as ModelSetupJournal,
  AppModelResourceSetupJournal as ModelResourceSetupJournal,
} from "@mdbase-dev/sdk/app-host";

export type ModelSetupView =
  | { readonly state: "required" }
  | { readonly state: "ready" }
  | {
      readonly state: "waiting";
      readonly reason: "waiting_for_access" | "catching_up";
      readonly message: string;
    }
  | { readonly state: "outcome_unknown"; readonly message: string }
  | { readonly state: "blocked"; readonly message: string }
  | { readonly state: "permission_required"; readonly message: string };

export type ModelSetupProgress =
  "installing" | "waiting_for_confirmation" | "checking_outcome";
export type ModelSetupProgressListener = (progress: ModelSetupProgress) => void;

/** Provider-neutral explicit model installation and original-intent recovery. */
export interface TaskNotesModelSetup {
  inspect(): Promise<ModelSetupView>;
  /** Notify only to repeat a read-only inspection, never to install or resume. */
  onReadinessChange?(listener: () => void): () => void;
  install(progress?: ModelSetupProgressListener): Promise<void>;
  resume(progress?: ModelSetupProgressListener): Promise<void>;
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
