import { toPlain, type wire } from "@mdbase-dev/sdk";
import { buildTaskNotesMdbaseResources } from "@tasknotes/model/mdbase";
import type { ModelDefinitionOps } from "../application/ports/model-setup";

function definitionFolder(
  settings: ReadonlyMap<string | number, wire.Value>,
  key: string,
  fallback: string,
): string {
  const value = settings.get(key);
  const folder = value === undefined ? fallback : toPlain(value);
  if (
    typeof folder !== "string" ||
    !folder ||
    folder.includes("\\") ||
    folder.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("The collection's definition folders require repair.");
  return folder;
}

/** Explicit installation only. Folder defaults are the native configuration
 * defaults, never a substitute for an absent TaskNotes model during reads.
 * Inline schemas live in these two Markdown definitions; auxiliary schema
 * files and collection configuration are deliberately not write operations.
 */
export function nativeModelDefinitionPlan(
  settings: wire.Value,
): ModelDefinitionOps {
  if (
    !(settings instanceof Map) ||
    [...settings.keys()].some((key) => typeof key !== "string")
  )
    throw new Error(
      "Mdbase has not supplied structured definition-folder settings.",
    );
  const typesFolder = definitionFolder(settings, "types_folder", "_types");
  const contractsFolder = definitionFolder(
    settings,
    "contracts_folder",
    "_contracts",
  );
  if (typesFolder === contractsFolder)
    throw new Error("The collection's definition folders must be distinct.");
  const resources = buildTaskNotesMdbaseResources({
    profiles: ["core-lite"],
    typesFolder,
    contractsFolder,
  });
  return Object.freeze([
    Object.freeze({
      kind: "resource_put" as const,
      path: resources.paths.contract,
      doc: resources.contractDocument,
      mustNotExist: true as const,
    }),
    Object.freeze({
      kind: "resource_put" as const,
      path: resources.paths.type,
      doc: resources.typeDocument,
      mustNotExist: true as const,
    }),
  ]) as ModelDefinitionOps;
}
