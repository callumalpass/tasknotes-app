import type {
  CollectionTransferProgress,
  CollectionTransferResult,
} from "../storage/collection-transfer";

export type CollectionMigrationState =
  | { step: "destination" }
  | { step: "authorizing" }
  | {
      step: "running";
      destinationName: string;
      progress: CollectionTransferProgress;
      verificationUri?: string;
    }
  | {
      step: "error";
      destinationName?: string;
      message: string;
      canRetry: boolean;
      mustResume?: boolean;
    }
  | {
      step: "complete";
      destinationName: string;
      result: CollectionTransferResult;
    };

export function isCollectionMigrationLocked(
  migration: CollectionMigrationState | null,
): boolean {
  return (
    migration?.step === "running" ||
    migration?.step === "authorizing" ||
    (migration?.step === "error" && migration.mustResume === true)
  );
}
