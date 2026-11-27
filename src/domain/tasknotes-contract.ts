import {
  TASKNOTES_ACCEPTED_CONTRACT_VERSIONS,
  TASKNOTES_CONTRACT_DIGEST,
  TASKNOTES_LEGACY_CONTRACT_DIGESTS,
} from "@tasknotes/model/mdbase";
import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model/types";

export const TASKNOTES_CURRENT_CONTRACT = {
  version: "0.3.0-rc.7",
  digest:
    "sha256:1a0b33928c1e35399b0cffe808047cdca42a0881da27570a10fa6ead51dc51b2",
};

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
  TASKNOTES_CURRENT_CONTRACT,
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
  for (const version of [
    TASKNOTES_CURRENT_CONTRACT.version,
    ...TASKNOTES_ACCEPTED_CONTRACT_VERSIONS,
  ]) {
    const match = implementations.find(
      (candidate) => candidate.version === version,
    );
    if (match) return match;
  }
  return undefined;
}

export const TASKNOTES_MISSING_CONTRACT_MESSAGE = `This collection does not provide tasknotes.task ${TASKNOTES_CURRENT_CONTRACT.version}.`;

/** Run model operations whose published version check still predates rc.7.
 * The rc.7 binding is unchanged, and its persisted version must stay intact. */
export function editTaskNotesType(
  definition: Record<string, unknown>,
  edit: (definition: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
  const implementation = taskNotesImplementationOf(definition);
  if (implementation?.version !== TASKNOTES_CURRENT_CONTRACT.version)
    return edit(definition);
  const implementations = definition.implements as unknown[];
  const index = implementations.indexOf(implementation);
  const compatible = [...implementations];
  compatible[index] = { ...implementation, version: TASKNOTES_SPEC_VERSION };
  const result = edit({ ...definition, implements: compatible });
  const edited = [...(result.implements as Record<string, unknown>[])];
  edited[index] = { ...edited[index], version: implementation.version };
  return { ...result, implements: edited };
}
