import bundledManifest from "../generated/mdbase-app.json";

import { connectProblemFromError } from "../application/connect-problem";

export const NEWER_TASKNOTES_COLLECTION_MESSAGE =
  "This collection was upgraded by a newer TaskNotes. Update the TaskNotes App, then connect again. Your task notes have not been changed by this failed setup.";

/** Translate only a confirmed newer TaskNotes contract failure. Unrelated
 * schema/pack failures keep their diagnostic instead of suggesting a downgrade. */
export function collectionErrorMessage(reason: unknown): string {
  const problem = connectProblemFromError(reason);
  const message =
    problem?.message ??
    (reason instanceof Error ? reason.message : String(reason));
  const code: string = problem?.code ?? "";
  if (
    (code === "data_contract_version_mismatch" ||
      message.includes("data_contract_version_mismatch")) &&
    newerRequiredContract(message)
  )
    return NEWER_TASKNOTES_COLLECTION_MESSAGE;
  return message;
}

function newerRequiredContract(message: string): boolean {
  const required = message.match(
    /requires data contract ['"]tasknotes\.task['"] (\d+\.\d+\.\d+(?:-rc\.\d+)?)/,
  )?.[1];
  if (!required) return false;
  const requested = contractVersion(required);
  const declared = bundledManifest.requirements.contracts.find(
    (contract) => contract.id === "tasknotes.task",
  )?.version;
  const supported = declared ? contractVersion(declared) : null;
  if (!requested || !supported) return false;
  for (let index = 0; index < requested.length; index++) {
    if (requested[index] !== supported[index])
      return requested[index] > supported[index];
  }
  return false;
}

function contractVersion(version: string): number[] | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/);
  return match
    ? [
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
        match[4] === undefined ? Infinity : Number(match[4]),
      ]
    : null;
}
