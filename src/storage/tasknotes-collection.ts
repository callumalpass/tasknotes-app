import type {
  CollectionContractDescriptor,
  CollectionTypeDescriptor,
  JsonObject,
} from "@mdbase/connect-protocol";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { resolveTaskCollectionConfiguration } from "../domain/task-configuration";

export interface TaskCollectionResources {
  contracts: CollectionContractDescriptor[];
  types: CollectionTypeDescriptor[];
}

export interface ResolvedTaskCollection {
  model: TaskNotesTaskModel;
  typeName: string;
}

export function resolveTaskCollection(
  resources: TaskCollectionResources,
): ResolvedTaskCollection {
  const contract = resources.contracts.find(
    (candidate) => candidate.id === "tasknotes.task",
  );
  if (!contract)
    throw new Error("This collection does not provide TaskNotes tasks.");
  const type = resources.types.find(
    (candidate) => candidate.name === contract.type_name,
  );
  if (!type)
    throw new Error("The TaskNotes task type is missing from this collection.");

  return {
    typeName: contract.type_name,
    model: new TaskNotesTaskModel(
      resolveTaskCollectionConfiguration({
        schema: { value: type.schema },
        fields: type.definition?.fields,
        "x-tasknotes": contract.configuration,
      }),
      {
        typeName: contract.type_name,
        recordsFolder: recordsFolder(type.collection),
      },
    ),
  };
}

function recordsFolder(collection: JsonObject | undefined): string {
  const path = collection?.path;
  if (!path || typeof path !== "object" || Array.isArray(path)) return "tasks";
  const descriptor = path as Record<string, unknown>;
  const folder = descriptor.folder;
  if (typeof folder === "string" && folder.trim()) return folder;
  const pattern = descriptor.pattern;
  if (typeof pattern !== "string") return "tasks";
  const marker = pattern.search(/\{[^}]+\}/);
  const prefix = (marker < 0 ? pattern : pattern.slice(0, marker))
    .replace(/\/+$/g, "")
    .trim();
  return prefix || "tasks";
}
