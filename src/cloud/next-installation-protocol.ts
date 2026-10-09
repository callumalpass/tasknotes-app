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
        | "close";
    }
  | { kind: "confirm-account"; accountId: string }
  | { kind: "start-consent"; requestedCreateCollections: boolean }
  | { kind: "create-collection"; reconcile: boolean };
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
  | NextCreatedCollection
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
