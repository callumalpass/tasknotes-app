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

  return resolveTaskTypeDefinition(type.definition ?? {}, {
    typeName: contract.type_name,
    schema: type.schema,
    fields: type.definition?.fields as JsonObject | undefined,
    collection: type.collection,
    configuration: contract.configuration,
  });
}

export function resolveTaskTypeDefinition(
  definition: Record<string, unknown>,
  overrides: {
    typeName?: string;
    schema?: JsonObject;
    fields?: JsonObject;
    collection?: JsonObject;
    configuration?: JsonObject;
  } = {},
): ResolvedTaskCollection {
  const configuration =
    overrides.configuration ??
    (definition["x-tasknotes"] as JsonObject | undefined);
  if (configuration?.contract !== "tasknotes.task")
    throw new Error("This type does not provide the TaskNotes task contract.");
  const schema =
    overrides.schema ??
    ((definition.schema as Record<string, unknown> | undefined)?.value as
      JsonObject | undefined);
  const collection =
    overrides.collection ?? (definition.collection as JsonObject | undefined);
  const typeName =
    overrides.typeName ??
    (typeof definition.name === "string" ? definition.name : undefined);
  if (!typeName)
    throw new Error("The TaskNotes task type does not have a name.");
  return {
    typeName,
    model: new TaskNotesTaskModel(
      resolveTaskCollectionConfiguration({
        schema: { value: schema },
        fields: overrides.fields ?? definition.fields,
        "x-tasknotes": configuration,
      }),
      {
        typeName,
        recordsFolder: recordsFolder(collection),
        pathPattern: pathPattern(collection),
      },
    ),
  };
}

function pathPattern(collection: JsonObject | undefined): string | undefined {
  const path = collection?.path;
  if (!path || typeof path !== "object" || Array.isArray(path))
    return undefined;
  const descriptor = path as Record<string, unknown>;
  const pattern = descriptor.pattern ?? descriptor.template;
  if (typeof pattern !== "string" || !pattern.trim()) return undefined;
  const template = pattern.trim().replace(/^\/+/, "");
  const folder =
    typeof descriptor.folder === "string"
      ? descriptor.folder.trim().replace(/^\/+|\/+$/g, "")
      : "";
  if (!folder || template === folder || template.startsWith(`${folder}/`))
    return template;
  return `${folder}/${template}`;
}

function recordsFolder(collection: JsonObject | undefined): string {
  const path = collection?.path;
  if (!path || typeof path !== "object" || Array.isArray(path)) return "tasks";
  const descriptor = path as Record<string, unknown>;
  const folder = descriptor.folder;
  if (typeof folder === "string" && folder.trim()) return folder;
  const pattern = descriptor.pattern ?? descriptor.template;
  if (typeof pattern !== "string") return "tasks";
  const marker = pattern.search(/\{[^}]+\}/);
  const prefix = (marker < 0 ? pattern : pattern.slice(0, marker))
    .replace(/\/+$/g, "")
    .trim();
  return prefix || "tasks";
}
