import type {
  ModelPackPlan,
  ModelResourcePlan,
  ModelSetupIntent,
} from "../application/ports/model-setup";
import { modelPackPlan, modelResourcePlan } from "./next-model-setup-intent";
import type {
  AppBundledReleaseTrust,
  AppInstallationSignInView,
  AppInstallationCollection,
  AppInstallationCollectionConsentView,
} from "@mdbase-dev/sdk/app-host";

/** Public BUILD context and immutable artifact, not an auth/credential message. */
export interface NextInstallationBuildInput {
  environment: "lab" | "production";
  appOrigin: string;
  release: AppBundledReleaseTrust;
  runtime: Uint8Array;
  runtimeSha256: string;
}
export type NextInstallationCommand =
  | {
      kind: "open";
      build: NextInstallationBuildInput;
      mode: "fresh" | "existing";
      requestedCreateCollections?: boolean;
    }
  | {
      kind:
        | "start"
        | "renew-expired"
        | "exchange"
        | "attest"
        | "collections"
        | "exchange-consent"
        | "model-setup-verified"
        | "close";
    }
  | { kind: "confirm-account"; accountId: string }
  | { kind: "start-consent"; requestedCreateCollections: boolean }
  | { kind: "open-collection"; collectionId: string }
  | { kind: "set-foreground"; active: boolean }
  | { kind: "create-collection"; reconcile: boolean }
  | { kind: "model-setup-intent"; action: "load" }
  | { kind: "model-setup-intent"; action: "prepare"; plan: ModelPackPlan }
  | {
      kind: "model-setup-intent";
      action: "attempt" | "confirm" | "verify";
      mutationId: string;
    }
  | {
      kind: "model-resource-setup-intent";
      action: "prepare";
      plan: ModelResourcePlan;
    }
  | {
      kind: "model-resource-setup-intent";
      action: "prepare-round";
      plan: ModelResourcePlan;
      previousMutationId: string;
    }
  | {
      kind: "model-resource-setup-intent";
      action: "attempt" | "confirm" | "verify";
      mutationId: string;
    };
export interface NextOpenedCollection {
  readonly kind: "collection";
  readonly scope: Readonly<{
    account: string;
    installation: string;
    collection: string;
  }>;
  readonly displayName: string;
  /** Original creator flow still awaits model completion, not a grant. */
  readonly requiresTaskNotesModelSetup: boolean;
  readonly channel: MessagePort;
}
export interface NextCreatedCollection {
  readonly kind: "created-collection";
  readonly collectionId: string;
  /** Presentation fallback, not a persisted collection name. */
  readonly displayName: "New collection";
}
export interface NextInstallationRequest {
  version: 1;
  id: number;
  command: NextInstallationCommand;
}
export type NextInstallationResult =
  | AppInstallationSignInView
  | AppInstallationCollectionConsentView
  | readonly AppInstallationCollection[]
  | NextOpenedCollection
  | NextCreatedCollection
  | ModelSetupIntent
  | null;
export type NextInstallationResponse =
  | { version: 1; id: number; ok: true; result: NextInstallationResult }
  | { version: 1; id: number; ok: false; reason: string };
export const NATIVE_WASM_MAX_BYTES = 3_300_000;
export function isNextInstallationCommand(
  value: unknown,
): value is NextInstallationCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value as Record<string, unknown>;
  const keys = Object.keys(command).sort().join(",");
  switch (command.kind) {
    case "open":
      return (
        (keys === "build,kind,mode" ||
          keys === "build,kind,mode,requestedCreateCollections") &&
        (command.mode === "fresh" || command.mode === "existing") &&
        (command.requestedCreateCollections === undefined ||
          typeof command.requestedCreateCollections === "boolean") &&
        !!command.build &&
        typeof command.build === "object"
      );
    case "confirm-account":
      return (
        keys === "accountId,kind" &&
        typeof command.accountId === "string" &&
        command.accountId.length === 36
      );
    case "open-collection":
      return (
        keys === "collectionId,kind" &&
        typeof command.collectionId === "string" &&
        /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(
          command.collectionId,
        )
      );
    case "set-foreground":
      return keys === "active,kind" && typeof command.active === "boolean";
    case "model-resource-setup-intent":
      if (command.action === "prepare" || command.action === "prepare-round") {
        if (command.action === "prepare-round") {
          if (
            keys !== "action,kind,plan,previousMutationId" ||
            typeof command.previousMutationId !== "string" ||
            !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(
              command.previousMutationId,
            )
          )
            return false;
        } else if (keys !== "action,kind,plan") return false;
        try {
          modelResourcePlan(command.plan);
          return true;
        } catch {
          return false;
        }
      }
      return (
        keys === "action,kind,mutationId" &&
        ["attempt", "confirm", "verify"].includes(command.action as string) &&
        typeof command.mutationId === "string" &&
        /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(command.mutationId)
      );
    case "model-setup-intent":
      if (command.action === "load") return keys === "action,kind";
      if (command.action === "prepare") {
        if (keys !== "action,kind,plan") return false;
        try {
          modelPackPlan(command.plan);
          return true;
        } catch {
          return false;
        }
      }
      return (
        keys === "action,kind,mutationId" &&
        ["attempt", "confirm", "verify"].includes(command.action as string) &&
        typeof command.mutationId === "string" &&
        /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(command.mutationId)
      );
    case "create-collection":
      return (
        keys === "kind,reconcile" && typeof command.reconcile === "boolean"
      );
    case "start-consent":
      return (
        keys === "kind,requestedCreateCollections" &&
        typeof command.requestedCreateCollections === "boolean"
      );
    case "start":
    case "renew-expired":
    case "exchange":
    case "attest":
    case "collections":
    case "exchange-consent":
    case "model-setup-verified":
    case "close":
      return keys === "kind";
    default:
      return false;
  }
}
const publicErrorCodes = new Set([
  "unavailable",
  "busy",
  "binding",
  "response",
  "recovery_required",
  "outcome_unknown",
  "fenced",
  "refused",
  "aborted",
  "expired",
  "closed",
]);
export function isInstallationErrorCode(value: unknown): value is string {
  return typeof value === "string" && publicErrorCodes.has(value);
}
export function installationErrorCode(error: unknown): string {
  const reason =
    error && typeof error === "object" && "reason" in error
      ? error.reason
      : undefined;
  return isInstallationErrorCode(reason) ? reason : "unavailable";
}
