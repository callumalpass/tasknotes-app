import type { MdbaseClient } from "@mdbase-dev/sdk";
import { parseFrontmatter } from "@tasknotes/model/frontmatter";
import { TASKNOTES_SETTINGS_TYPE } from "@tasknotes/model/settings";
import { TaskNotesModelRequiredError } from "../application/ports/model-setup";
import {
  readableTaskNotesContract,
  TASKNOTES_READABLE_CONTRACTS,
  TASKNOTES_MISSING_CONTRACT_MESSAGE,
} from "../domain/tasknotes-contract";
import { collectionTimezone } from "../domain/runtime-timezone";
import {
  resolveTaskTypeDefinition,
  type ResolvedTaskProvider,
} from "./tasknotes-collection";

/** Load app-specific models from the native replica catalog and exact sources.
 * No classic describe adapter, inferred task type, or default-schema fallback.
 */
export interface NextTaskProvider extends ResolvedTaskProvider {
  sourcePath: string;
}

export async function nextTaskProviders(
  client: MdbaseClient,
  signal: AbortSignal,
  options: { settings?: Readonly<Record<string, unknown>> } = {},
): Promise<NextTaskProvider[]> {
  return (await nextTaskCatalog(client, signal, options)).providers;
}

export interface NextTaskCatalog {
  providers: NextTaskProvider[];
  signature: string;
  viewTypes: Set<string>;
  /** Whether the collection defines the TaskNotes settings type. */
  settingsType: boolean;
}

/** The current tasknotes.task contract is preferred; rc.5 collections still resolve. */
export async function nextTaskCatalog(
  client: MdbaseClient,
  signal: AbortSignal,
  options: { settings?: Readonly<Record<string, unknown>> } = {},
): Promise<NextTaskCatalog> {
  const catalog = await client.describe({ signal });
  signal.throwIfAborted();
  if (!readableTaskNotesContract(catalog.contracts))
    throw new TaskNotesModelRequiredError(TASKNOTES_MISSING_CONTRACT_MESSAGE);
  const timezone = collectionTimezone(catalog.settings);
  const byVersion = new Map<string, NextTaskProvider[]>();
  const revisionlessSources = new Map<string, string>();
  for (const type of catalog.types) {
    const typeContract = readableTaskNotesContract(
      catalog.contracts.filter((candidate) =>
        type.implements.some(
          (item) =>
            item.contract === candidate.id &&
            item.version === candidate.version,
        ),
      ),
    );
    if (!typeContract) continue;
    const implementations = type.implements.filter(
      (item) =>
        item.contract === typeContract.id &&
        item.version === typeContract.version,
    );
    if (!implementations.length) continue;
    if (implementations.length !== 1)
      throw new Error(
        `The type ${type.name} has ambiguous TaskNotes implementations.`,
      );
    const implementation = implementations[0]!;
    const resource = await client.resources.get(type.path, { signal });
    signal.throwIfAborted();
    if (resource.state !== "confirmed")
      throw new TaskNotesModelRequiredError(
        "The TaskNotes type definition is not confirmed.",
      );
    if (resource.text === undefined)
      throw new Error(
        `Mdbase did not return the task type source ${type.path}.`,
      );
    const definition = parseFrontmatter(resource.text).frontmatter;
    if (type.revision === undefined)
      revisionlessSources.set(type.path, resource.text);
    const binding = implementation.binding ?? {};
    if (!binding || typeof binding !== "object" || Array.isArray(binding))
      throw new Error(
        `The type ${type.name} has an invalid TaskNotes binding.`,
      );
    const providers = byVersion.get(typeContract.version) ?? [];
    providers.push({
      ...resolveTaskTypeDefinition(definition, {
        typeName: type.name,
        fields: implementation.fields,
        configuration: binding,
        version: typeContract.version,
        timezone,
        settings: options.settings,
      }),
      sourcePath: type.path,
    });
    byVersion.set(typeContract.version, providers);
  }
  const providers = TASKNOTES_READABLE_CONTRACTS.flatMap(
    ({ version }) => byVersion.get(version) ?? [],
  );
  if (!providers.length)
    throw new TaskNotesModelRequiredError(
      "The TaskNotes contract has no implementing types.",
    );
  return {
    providers,
    signature: JSON.stringify([
      timezone,
      catalog.types
        .map((type) => [
          type.name,
          type.path,
          type.revision ?? revisionlessSources.get(type.path),
        ])
        .sort(),
      catalog.contracts
        .map((contract) => [contract.id, contract.digest])
        .sort(),
    ]),
    viewTypes: new Set(
      catalog.contracts
        .filter((contract) => contract.id === "obsidian.base")
        .flatMap((contract) => contract.implementedBy),
    ),
    settingsType: catalog.types.some(
      (type) => type.name === TASKNOTES_SETTINGS_TYPE,
    ),
  };
}
