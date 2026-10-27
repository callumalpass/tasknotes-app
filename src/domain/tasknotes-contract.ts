import {
  TASKNOTES_ACCEPTED_CONTRACT_VERSIONS,
  TASKNOTES_CONTRACT_DIGEST,
  TASKNOTES_LEGACY_CONTRACT_DIGESTS,
} from "@tasknotes/model/mdbase";
import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model/types";

/**
 * The tasknotes.task contracts TaskNotes reads, newest first: the current
 * contract, then each earlier one whose published digest is known. A type on
 * an earlier contract keeps working; its binding may still hold settings the
 * current contract moved to the TaskNotes settings record.
 */
export const TASKNOTES_READABLE_CONTRACTS: readonly {
  version: string;
  digest: string;
}[] = [
  { version: TASKNOTES_SPEC_VERSION, digest: TASKNOTES_CONTRACT_DIGEST },
  ...Object.entries(TASKNOTES_LEGACY_CONTRACT_DIGESTS).map(
    ([version, digest]) => ({ version, digest }),
  ),
];

/** The newest readable tasknotes.task contract a catalog provides. */
export function readableTaskNotesContract<
  Contract extends { id: string; version: string; digest: string },
>(contracts: readonly Contract[]): Contract | undefined {
  for (const readable of TASKNOTES_READABLE_CONTRACTS) {
    const match = contracts.find(
      (candidate) =>
        candidate.id === "tasknotes.task" &&
        candidate.version === readable.version &&
        candidate.digest === readable.digest,
    );
    if (match) return match;
  }
  return undefined;
}

/** The newest TaskNotes implementation a type definition declares. */
export function taskNotesImplementationOf(
  definition: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const implementations = Array.isArray(definition.implements)
    ? definition.implements.filter(
        (candidate): candidate is Record<string, unknown> =>
          candidate !== null &&
          typeof candidate === "object" &&
          !Array.isArray(candidate) &&
          (candidate as Record<string, unknown>).contract === "tasknotes.task",
      )
    : [];
  for (const version of TASKNOTES_ACCEPTED_CONTRACT_VERSIONS) {
    const match = implementations.find(
      (candidate) => candidate.version === version,
    );
    if (match) return match;
  }
  return undefined;
}

export const TASKNOTES_MISSING_CONTRACT_MESSAGE = `This collection does not provide tasknotes.task ${TASKNOTES_SPEC_VERSION}.`;
