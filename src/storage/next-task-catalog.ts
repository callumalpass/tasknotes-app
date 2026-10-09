import { toPlain, type MdbaseClient } from "@mdbase-dev/sdk";
import { parseFrontmatter } from "@tasknotes/model/frontmatter";
import { TASKNOTES_CONTRACT_DIGEST } from "@tasknotes/model/mdbase";
import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model/types";
import { TaskNotesModelRequiredError } from "../application/ports/model-setup";
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
): Promise<NextTaskProvider[]> {
  const catalog = await client.describe(signal);
  signal.throwIfAborted();
  const contract = catalog.contracts.find(
    (item) =>
      item.id === "tasknotes.task" &&
      item.version === TASKNOTES_SPEC_VERSION &&
      item.digest === TASKNOTES_CONTRACT_DIGEST,
  );
  if (!contract)
    throw new TaskNotesModelRequiredError(
      `This collection does not provide tasknotes.task ${TASKNOTES_SPEC_VERSION}.`,
    );
  const providers: NextTaskProvider[] = [];
  for (const type of catalog.types) {
    const implementations = type.implements.filter(
      (item) =>
        item.contract === contract.id && item.version === contract.version,
    );
    if (!implementations.length) continue;
    if (implementations.length !== 1)
      throw new Error(
        `The type ${type.name} has ambiguous TaskNotes implementations.`,
      );
    const implementation = implementations[0]!;
    const resource = await client.resources.get(type.path, signal);
    signal.throwIfAborted();
    if (resource.text === undefined)
      throw new Error(
        `Mdbase did not return the task type source ${type.path}.`,
      );
    const definition = parseFrontmatter(resource.text).frontmatter;
    const binding =
      implementation.binding === undefined
        ? {}
        : toPlain(implementation.binding);
    if (!binding || typeof binding !== "object" || Array.isArray(binding))
      throw new Error(
        `The type ${type.name} has an invalid TaskNotes binding.`,
      );
    providers.push({
      ...resolveTaskTypeDefinition(definition, {
        typeName: type.name,
        fields: Object.fromEntries(implementation.fields),
        configuration: binding,
      }),
      sourcePath: type.path,
    });
  }
  if (!providers.length)
    throw new TaskNotesModelRequiredError(
      "The TaskNotes contract has no implementing types.",
    );
  return providers;
}
