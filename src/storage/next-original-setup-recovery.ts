import {
  ModelSetupError,
  type ModelSetupIntent,
  type ModelSetupScope,
} from "../application/ports/model-setup";
import { decode } from "../cloud/next-model-setup-intent";

type OriginalSetupIntent = Exclude<ModelSetupIntent, { version: 1 }>;

const changed = () =>
  new ModelSetupError({
    state: "blocked",
    message:
      "The original admitted setup is unavailable or changed. Its identity and plan must be preserved; no replacement will be submitted.",
  });

/** Clone and pin the original identity before the operation queue yields. */
export function captureOriginalSetupRecovery(
  value: ModelSetupIntent,
  scope: ModelSetupScope,
): OriginalSetupIntent {
  const original = decode(value, scope);
  if (
    original.version === 1 ||
    (original.phase !== "attempted" && original.phase !== "confirmed")
  )
    throw changed();
  return original;
}

/** Allow only forward phases of this exact admitted operation, never PREPARED. */
export function recheckOriginalSetupRecovery(
  original: OriginalSetupIntent,
  stored: ModelSetupIntent | null,
  scope: ModelSetupScope,
): OriginalSetupIntent {
  if (!stored) throw changed();
  const current = decode(stored, scope);
  if (
    current.version === 1 ||
    current.phase === "prepared" ||
    (original.phase === "confirmed" && current.phase === "attempted") ||
    JSON.stringify({ ...current, phase: original.phase }) !==
      JSON.stringify(original)
  )
    throw changed();
  return current;
}
